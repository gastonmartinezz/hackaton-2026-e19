package uy.guiame.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
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
    ) : Screen

    data class Site(val url: String, val card: Card) : Screen
}

/** Un estado de tarjeta por respuesta (R1). */
sealed interface Card {
    /** «Estoy mirando la página…» (A-04) */
    data object Looking : Card
    /** «Estoy fijándome si funcionó…» (A-07) */
    data object Checking : Card
    data class Options(val options: List<PageOption>) : Card
    data class Step(val step: GuideStep, val doneCount: Int, val sensitive: Boolean) : Card
    data class Done(val evidence: String) : Card
    /** «¿Pudiste terminar?» (A-16) */
    data object AskFinished : Card
    /** «No pude leer esta página» (A-19) */
    data object Error : Card
}

/**
 * Lógica del spike: inicio → /v1/interpret → sitio → /v1/options → elegir
 * opción → /v1/next-step hasta terminar. Versión reducida de
 * `apps/desktop/src/main/assistant.ts`: sin voz, sin dictado, sin protección de
 * sitios y sin «Tocá … por mí».
 */
class GuiameViewModel(private val api: GuiameApi = GuiameApi()) : ViewModel() {
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
        screen = home.copy(query = text)
    }

    fun search() {
        val home = screen as? Screen.Home ?: return
        val text = home.query.trim()
        if (text.isEmpty() || home.loading) return
        chat.clear()
        sessionId = null
        ask(text)
    }

    fun answer(text: String) = ask(text)

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
            when (result) {
                is InterpretResult.Redirect -> openSite(result.url)
                is InterpretResult.Sites -> screen = Screen.Home(query = text, sites = result.sites)
                is InterpretResult.Question -> {
                    chat += ChatMessage("assistant", result.message)
                    screen = Screen.Home(query = home.query, question = result.message, answers = result.answers)
                }
            }
        }
    }

    fun openSite(url: String) {
        resetGuide()
        screen = Screen.Site(url, Card.Looking)
    }

    fun goHome() {
        pageJob?.cancel()
        resetGuide()
        bridge?.clear()
        screen = Screen.Home()
    }

    /* ------------------------------ Sitio ----------------------------- */

    private fun setCard(card: Card) {
        val site = screen as? Screen.Site ?: return
        screen = site.copy(card = card)
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
        val step = steps.getOrNull(stepIndex) ?: return
        completeCurrent(step)
        advance()
    }

    fun chooseOption(option: PageOption) {
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
        setCard(Card.Step(step, doneCount, sensitive))
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

        /** Solo el tipo de error y el estado HTTP: nunca lo que pidió la persona ni la página. */
        fun logFailure(error: Throwable) {
            val detail = (error as? ApiException)?.let { "HTTP ${it.status}" } ?: error.javaClass.simpleName
            android.util.Log.w("Guiame", "La API falló: $detail")
        }
    }
}
