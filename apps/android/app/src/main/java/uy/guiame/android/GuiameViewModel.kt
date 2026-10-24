package uy.guiame.android

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Pantalla actual: el inicio (buscador) o un sitio abierto con la tarjeta de ayuda. */
sealed interface Screen {
    data class Home(
        val query: String = "",
        val loading: Boolean = false,
        val question: String? = null,
        val answers: List<String> = emptyList(),
        val sites: List<SiteChoice> = emptyList(),
        val error: Boolean = false,
        val voice: Voice = Voice.Idle,
    ) : Screen {
        /** Con dictado en curso o terminado, el círculo sube y queda como encabezado. */
        val docked: Boolean get() = voice is Voice.Transcribing || voice is Voice.Heard
    }

    data class Site(val url: String, val card: Card) : Screen
}

/** Dictado del buscador. */
sealed interface Voice {
    data object Idle : Voice
    /** Grabando; `level` (0 a 1) mueve el círculo. */
    data class Listening(val level: Float = 0f) : Voice
    data object Transcribing : Voice
    /** Lo que se entendió: queda en el encabezado mientras se busca. */
    data class Heard(val text: String) : Voice
    data class Problem(val kind: VoiceProblem) : Voice
}

enum class VoiceProblem { Empty, Failed, Busy, Off, Denied, Mic }

/** Un estado de tarjeta por respuesta (R1). */
sealed interface Card {
    /** «Estoy mirando la página…» (A-04) */
    data object Looking : Card
    /** «Estoy fijándome si funcionó…» (A-07) */
    data object Checking : Card
    data class Options(val options: List<PageOption>) : Card
    /** `offerClick`: Guíame puede tocar el control si la persona lo confirma (CLAUDE.md §2). */
    data class Step(val step: GuideStep, val doneCount: Int, val sensitive: Boolean, val offerClick: Boolean = false) : Card
    data class Done(val evidence: String) : Card
    /** «¿Pudiste terminar?» (A-16) */
    data object AskFinished : Card
    /** «No pude leer esta página» (A-19) */
    data object Error : Card
}

/** El asistente de voz: qué está haciendo ahora (se muestra en la tarjeta o el inicio). */
sealed interface Assistant {
    data object Quiet : Assistant
    data object Speaking : Assistant
    /** Escucha la respuesta; `level` (0 a 1) es el volumen. */
    data class Listening(val level: Float = 0f) : Assistant
    data object Thinking : Assistant
}

/**
 * Lógica del spike: inicio (escrito o dictado con /v1/transcribe) →
 * /v1/interpret → sitio → /v1/options → elegir opción → /v1/next-step hasta
 * terminar. Versión reducida de `apps/desktop/src/main/assistant.ts`, sin
 * protección de sitios ni dictado de datos de formularios.
 *
 * Modo voz (como escritorio): Guíame lee en voz alta la pregunta, los sitios,
 * las opciones de la página y cada instrucción, y después escucha la respuesta
 * («la primera», el nombre de la opción, «sí»). Si el paso es un botón seguro,
 * ofrece tocarlo por la persona y lo toca solo si ella dice que sí o toca
 * «Tocá «…» por mí».
 */
class GuiameViewModel(app: Application) : AndroidViewModel(app) {
    private val api = GuiameApi()
    private val speaker = Speaker(app, api)

    /** Interruptor «Voz»: con el modo voz, Guíame lee y escucha. Prendido por defecto. */
    var voiceOn: Boolean by mutableStateOf(true)
        private set

    var assistant: Assistant by mutableStateOf(Assistant.Quiet)
        private set

    var screen: Screen by mutableStateOf(Screen.Home())
        private set

    /** Tamaño de letra de la capa Guíame (1.0 a 2.0). La página del sitio usa el mismo con textZoom. */
    var textScale: Float by mutableStateOf(1.2f)

    private var bridge: PageBridge? = null
    private var sessionId: String? = null
    private val chat = mutableListOf<ChatMessage>()

    private var navigation = 0
    private val navigationId get() = "n$navigation"
    private var pageJob: Job? = null

    private var optionId: String? = null
    private var steps: List<GuideStep> = emptyList()
    private var stepIndex = 0
    private var shownElementId: String? = null
    private val completed = mutableListOf<GuideStep>()
    private var doneCount = 0

    fun attach(bridge: PageBridge?) {
        this.bridge = bridge
    }

    /* ----------------------------- Inicio ----------------------------- */

    fun onQueryChange(text: String) {
        val home = screen as? Screen.Home ?: return
        // Si la persona escribe después de un problema con el dictado, el aviso ya no corresponde.
        screen = home.copy(query = text, voice = if (home.voice is Voice.Problem) Voice.Idle else home.voice)
    }

    fun search() {
        val home = screen as? Screen.Home ?: return
        val text = home.query.trim()
        if (text.isEmpty() || home.loading) return
        if (home.voice is Voice.Problem) setVoice(Voice.Idle)
        startSearch(text)
    }

    private fun startSearch(text: String) {
        hush()
        chat.clear()
        sessionId = null
        ask(text)
    }

    fun answer(text: String) {
        hush()
        ask(text)
    }

    private fun ask(text: String) {
        val home = screen as? Screen.Home ?: return
        chat += ChatMessage("user", text)
        screen = home.copy(loading = true, error = false)
        viewModelScope.launch {
            val result = runCatching { api.interpret(sessionId, chat) }.onFailure(::logFailure).getOrElse {
                screen = (screen as? Screen.Home)?.copy(loading = false, error = true) ?: screen
                return@launch
            }
            sessionId = result.sessionId ?: sessionId
            // El encabezado del dictado sigue arriba mientras dura la búsqueda.
            val voice = (screen as? Screen.Home)?.voice ?: Voice.Idle
            when (result) {
                is InterpretResult.Redirect -> openSite(result.url)
                is InterpretResult.Sites -> {
                    screen = Screen.Home(query = home.query, sites = result.sites, voice = voice)
                    converse(
                        sitesSpeech(result.sites.map { it.title }),
                        result.sites.map { Choice(it.title) },
                    ) { openSite(result.sites[it].url) }
                }
                is InterpretResult.Question -> {
                    chat += ChatMessage("assistant", result.message)
                    screen = Screen.Home(query = home.query, question = result.message, answers = result.answers, voice = voice)
                    // Lo que no coincide con una respuesta se manda tal cual: es la respuesta de la persona.
                    val choices = result.answers.map { Choice(it) } + Choice(VoiceTexts.UNSURE, kind = Choice.Kind.Unsure)
                    converse(questionSpeech(result.message, result.answers), choices, onFreeText = ::answer) { answer(choices[it].label) }
                }
            }
        }
    }

    /* ------------------------------ Dictado ----------------------------- */

    private val recorder = VoiceRecorder()
    private var voiceJob: Job? = null

    private fun setVoice(voice: Voice) {
        val home = screen as? Screen.Home ?: return
        screen = home.copy(voice = voice)
    }

    /**
     * Toque en el círculo: empieza a escuchar, o termina si ya escuchaba. Desde
     * el encabezado vuelve a empezar: la búsqueda anterior se descarta.
     */
    fun toggleVoice() {
        val home = screen as? Screen.Home ?: return
        when (home.voice) {
            is Voice.Listening -> recorder.stop()
            Voice.Transcribing -> Unit
            else -> {
                if (home.loading && !home.docked) return
                hush()
                chat.clear()
                sessionId = null
                screen = Screen.Home(query = home.query, voice = Voice.Listening())
                voiceJob?.cancel()
                voiceJob = viewModelScope.launch { listen() }
            }
        }
    }

    fun micDenied() = setVoice(Voice.Problem(VoiceProblem.Denied))

    /** Atrás desde el encabezado: vuelve al buscador. */
    fun closeVoice() {
        hush()
        voiceJob?.cancel()
        recorder.stop()
        val home = screen as? Screen.Home ?: return
        screen = Screen.Home(query = home.query)
    }

    private suspend fun listen() {
        val recording = try {
            recorder.record { level ->
                viewModelScope.launch {
                    if ((screen as? Screen.Home)?.voice is Voice.Listening) setVoice(Voice.Listening(level))
                }
            }
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            android.util.Log.w("Guiame", "El micrófono falló: ${error.javaClass.simpleName}")
            return setVoice(Voice.Problem(if (error is SecurityException) VoiceProblem.Denied else VoiceProblem.Mic))
        }
        val wav = recording.wav ?: return setVoice(Voice.Problem(VoiceProblem.Empty))
        setVoice(Voice.Transcribing)
        val text = try {
            // Un corte de conexión momentáneo con la API (el emulador o el wifi) se reintenta una vez.
            cleanTranscript(
                try {
                    api.transcribe(wav)
                } catch (error: java.io.IOException) {
                    api.transcribe(wav)
                },
            )
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            logFailure(error)
            val api = error as? ApiException
            val problem = when {
                api?.code == "AI_UNAVAILABLE" -> if (api.retryable) VoiceProblem.Busy else VoiceProblem.Off
                api?.code == "RATE_LIMITED" -> VoiceProblem.Busy
                else -> VoiceProblem.Failed
            }
            return setVoice(Voice.Problem(problem))
        }
        if (text.isEmpty()) return setVoice(Voice.Problem(VoiceProblem.Empty))
        // Lo dicho es la búsqueda: queda en el buscador y se envía como si se hubiera escrito.
        val home = screen as? Screen.Home ?: return
        screen = home.copy(query = text, voice = Voice.Heard(text))
        startSearch(text)
    }

    fun openSite(url: String) {
        hush()
        resetGuide()
        screen = Screen.Site(url, Card.Looking)
    }

    /** «Inicio»: deja lo que se estaba haciendo (sitio, pregunta o dictado) y vuelve al buscador vacío. */
    fun goHome() {
        hush()
        pageJob?.cancel()
        voiceJob?.cancel()
        recorder.stop()
        chat.clear()
        sessionId = null
        resetGuide()
        bridge?.clear()
        screen = Screen.Home()
    }

    /* ------------------------------ Sitio ----------------------------- */

    private fun setCard(card: Card) {
        val site = screen as? Screen.Site ?: return
        screen = site.copy(card = card)
        voiceFor(card)
    }

    /** Qué lee (y qué escucha) Guíame con cada estado de la tarjeta. */
    private fun voiceFor(card: Card) {
        when (card) {
            is Card.Options -> converse(optionsSpeech(card.options.map { it.title }), card.options.map { Choice(it.title) }) {
                chooseOption(card.options[it])
            }
            is Card.Step -> {
                val yes = Choice(clickForMeLabel(card.step.instruction), listOf("Tocalo", "Tocalo vos", "Hacelo"), Choice.Kind.Yes)
                converse(
                    stepSpeech(card.step.instruction, card.sensitive, card.offerClick),
                    if (card.offerClick) listOf(yes) else emptyList(),
                    retry = false,
                ) { clickForMe() }
            }
            // La evidencia es una cita textual de la página: no se lee.
            is Card.Done -> converse(VoiceTexts.COMPLETED)
            Card.AskFinished -> converse(VoiceTexts.DID_YOU_FINISH)
            Card.Looking, Card.Checking, Card.Error -> hush()
        }
    }

    /** Un documento nuevo: los `#el-N` anteriores ya no sirven. */
    fun onPageReady() {
        navigation++
        shownElementId = null
        // Redirecciones y cargas encadenadas: esperar a que la página se asiente.
        pageJob?.cancel()
        pageJob = viewModelScope.launch {
            delay(SETTLE_MS)
            val option = optionId
            if (option == null) {
                loadOptions()
            } else {
                // Cambió la página: lo que se esperaba en el paso actual ya pasó.
                steps.getOrNull(stepIndex)?.let { completeCurrent(it) }
                requestNext(steps.getOrNull(stepIndex) ?: steps.lastOrNull() ?: return@launch)
            }
        }
    }

    fun onInteraction(elementId: String) {
        val step = steps.getOrNull(stepIndex) ?: return
        if (elementId != shownElementId || step.field != null) return
        // Un clic que navega llega acá y después en onPageReady: el paso se completa una vez.
        if (step.waitFor == "navigation") return
        completeCurrent(step)
        advance()
    }

    /** «Está bien, seguir»: la persona confirma que escribió el dato del paso. */
    fun confirmStep() {
        hush()
        val step = steps.getOrNull(stepIndex) ?: return
        completeCurrent(step)
        advance()
    }

    fun chooseOption(option: PageOption) {
        hush()
        optionId = option.id
        steps = option.steps
        stepIndex = 0
        completed.clear()
        pageJob?.cancel()
        pageJob = viewModelScope.launch { requestNext(option.steps.first(), checking = false) }
    }

    fun finished(yes: Boolean) {
        // TODO(diseño): 17 «Sigamos. ¿Qué pasó?» y 32 «Bien. Gracias por avisarme.» no están en el spike.
        if (yes) goHome() else setCard(Card.Error)
    }

    private suspend fun loadOptions() {
        setCard(Card.Looking)
        val page = bridge?.extract(navigationId) ?: return setCard(Card.Error)
        val result = runCatching { api.options(sessionId, page) }.onFailure(::logFailure).getOrElse { return setCard(Card.Error) }
        sessionId = result.sessionId ?: sessionId
        setCard(if (result.options.isEmpty()) Card.Error else Card.Options(result.options))
    }

    private fun completeCurrent(step: GuideStep) {
        if (completed.lastOrNull() === step) return
        completed += step
        doneCount++
        stepIndex++
    }

    private fun advance() {
        bridge?.clear()
        val next = steps.getOrNull(stepIndex)
        pageJob?.cancel()
        pageJob = viewModelScope.launch {
            if (next != null && next.element != null) showStep(next) else requestNext(next ?: steps.last())
        }
    }

    private suspend fun requestNext(expected: GuideStep, checking: Boolean = true) {
        val option = optionId ?: return
        val session = sessionId ?: return setCard(Card.Error)
        setCard(if (checking) Card.Checking else Card.Looking)
        val page = bridge?.extract(navigationId) ?: return setCard(Card.Error)
        val result = runCatching { api.nextStep(session, option, expected, completed.toList(), page) }.onFailure(::logFailure)
            .getOrElse { return setCard(Card.Error) }
        sessionId = result.sessionId
        completed.clear()
        if (result.done) {
            resetGuide()
            return setCard(result.evidence?.let { Card.Done(it) } ?: Card.AskFinished)
        }
        steps = result.steps
        stepIndex = 0
        val first = steps.firstOrNull() ?: return setCard(Card.AskFinished)
        if (first.element == null) return setCard(Card.Step(first, doneCount, sensitive = false))
        showStep(first)
    }

    private suspend fun showStep(step: GuideStep) {
        val selector = step.element ?: return
        val shown = bridge?.show(navigationId, selector)
        if (shown == null || shown.result != "shown" || shown.elementId == null) {
            // TODO: reintentar con /v1/next-step como escritorio; en el spike se muestra el error.
            return setCard(Card.Error)
        }
        shownElementId = shown.elementId
        val sensitive = step.fieldSensitive || shown.sensitive
        // Dato sensible: solo el cursor en el lugar; la persona lo escribe (CLAUDE.md §2).
        if (sensitive) bridge?.focus(navigationId, shown.elementId)
        setCard(Card.Step(step, doneCount, sensitive, offerClick = canOfferClick(step, shown)))
    }

    /**
     * Se ofrece tocar el control por la persona solo si la IA lo marcó seguro,
     * es un botón o enlace de verdad, no pide un dato, no espera una
     * confirmación y no habla de pagar, comprar, borrar o algo irreversible.
     * El agente de página vuelve a revisar el rótulo antes de tocar.
     */
    private fun canOfferClick(step: GuideStep, shown: PageBridge.Shown): Boolean {
        if (!step.safeToClick || !shown.clickable || step.field != null || shown.sensitive) return false
        if (step.waitFor == "userConfirmation") return false
        return !isIrreversibleAction(step.instruction)
    }

    /** «Tocá «…» por mí» (o «sí» con la voz): la persona lo confirmó, Guíame toca el control resaltado. */
    fun clickForMe() {
        hush()
        val card = (screen as? Screen.Site)?.card as? Card.Step ?: return
        val elementId = shownElementId ?: return
        if (!card.offerClick) return
        viewModelScope.launch {
            // El clic llega al sitio como uno de la persona: la guía sigue por el camino de siempre (onInteraction / onPageReady).
            val result = bridge?.click(navigationId, elementId)
            if (result != "clicked") android.util.Log.w("Guiame", "No se pudo tocar el control: ${result ?: "sin respuesta"}")
        }
    }

    /* --------------------------- Modo voz del asistente --------------------------- */

    private val answerRecorder = VoiceRecorder()
    private var assistantJob: Job? = null

    /** «Voz»: prende o apaga el modo voz. Apagarlo corta lo que suena o escucha. */
    fun toggleVoiceMode() {
        voiceOn = !voiceOn
        if (!voiceOn) hush()
    }

    /** «Detener»: corta la lectura o la escucha; quedan los botones. */
    fun stopVoice() = hush()

    /** Corta lo que Guíame esté leyendo o escuchando. */
    private fun hush() {
        assistantJob?.cancel()
        assistantJob = null
        answerRecorder.stop()
        speaker.stop()
        assistant = Assistant.Quiet
    }

    private val micAllowed: Boolean
        get() = ContextCompat.checkSelfPermission(getApplication(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /**
     * Lee `text` y, si hay opciones, escucha la respuesta y la compara con ellas
     * (`matchChoice`). Al reconocerla dice «Elegiste «…».» y hace lo mismo que
     * tocar ese botón. Si no entiende, pregunta una vez «No te entendí. ¿Cuál
     * querés?»; después deja de escuchar y quedan los botones. Si no dice nada,
     * deja de escuchar sin error. Ni el audio ni lo transcripto se guardan ni se loguean.
     */
    private fun converse(
        text: String,
        choices: List<Choice> = emptyList(),
        retry: Boolean = true,
        onFreeText: ((String) -> Unit)? = null,
        onPick: (Int) -> Unit = {},
    ) {
        hush()
        if (!voiceOn || text.isBlank()) return
        assistantJob = viewModelScope.launch {
            try {
                assistant = Assistant.Speaking
                speaker.say(text)
                if (choices.isEmpty()) return@launch
                if (!micAllowed) {
                    android.util.Log.w("Guiame", "Sin permiso de micrófono: solo se lee")
                    return@launch
                }
                for (attempt in 1..2) {
                    val said = hear() ?: return@launch
                    when (val match = matchChoice(said, choices)) {
                        is ChoiceMatch.Match -> {
                            assistant = Assistant.Speaking
                            speaker.say(VoiceTexts.chosen(choices[match.index].label))
                            assistant = Assistant.Quiet
                            return@launch onPick(match.index)
                        }
                        ChoiceMatch.None -> if (onFreeText != null) {
                            assistant = Assistant.Quiet
                            return@launch onFreeText(said)
                        }
                        ChoiceMatch.Tie -> Unit
                    }
                    if (!retry || attempt == 2) return@launch
                    assistant = Assistant.Speaking
                    speaker.say(VoiceTexts.RETRY)
                }
            } finally {
                if (assistantJob == coroutineContext[Job]) assistant = Assistant.Quiet
            }
        }
    }

    /** Escucha una respuesta y la pasa a texto; null si no dijo nada o falló (quedan los botones). */
    private suspend fun hear(): String? {
        assistant = Assistant.Listening()
        val recording = runCatching {
            answerRecorder.record { level ->
                viewModelScope.launch { if (assistant is Assistant.Listening) assistant = Assistant.Listening(level) }
            }
        }.getOrElse {
            if (it is kotlinx.coroutines.CancellationException) throw it
            android.util.Log.w("Guiame", "El micrófono falló: ${it.javaClass.simpleName}")
            return null
        }
        val wav = recording.wav ?: return null
        assistant = Assistant.Thinking
        val text = runCatching { api.transcribe(wav) }.getOrElse {
            if (it is kotlinx.coroutines.CancellationException) throw it
            logFailure(it)
            return null
        }
        return cleanTranscript(text).ifEmpty { null }
    }

    override fun onCleared() {
        hush()
        speaker.shutdown()
    }

    private fun resetGuide() {
        optionId = null
        steps = emptyList()
        stepIndex = 0
        shownElementId = null
        completed.clear()
        doneCount = 0
    }

    private companion object {
        const val SETTLE_MS = 400L

        /** Igual que escritorio (voice.ts): una línea, sin espacios de más y hasta 500 caracteres. */
        fun cleanTranscript(text: String): String = text
            .replace(Regex("[\\p{Cc}\\p{Cf}]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(500)
            .trim()

        /** Solo el tipo de error y el estado HTTP: nunca lo que pidió la persona ni la página. */
        fun logFailure(error: Throwable) {
            val detail = (error as? ApiException)?.let { "HTTP ${it.status}" } ?: error.javaClass.simpleName
            android.util.Log.w("Guiame", "La API falló: $detail")
        }
    }
}
