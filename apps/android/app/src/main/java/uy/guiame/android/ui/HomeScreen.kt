package uy.guiame.android.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import uy.guiame.android.Assistant
import uy.guiame.android.R
import uy.guiame.android.Screen
import uy.guiame.android.SiteChoice
import uy.guiame.android.Voice
import uy.guiame.android.VoiceProblem

/**
 * Textos del dictado. «Hablar» y su nombre accesible salen de docs/02; el resto
 * es el mismo texto provisorio de escritorio (VOICE_TEXTS en VoiceSearch.tsx).
 * TODO(copy): la pantalla 33 («escuchando») no está diseñada; pendientes de aprobación.
 */
private object VoiceTexts {
    const val SPEAK = "Hablar"
    const val SPEAK_NAME = "Hablar: decirlo en voz alta"
    const val STOP = "Terminar"
    const val LISTENING = "Te escucho. Cuando termines, tocá «Terminar» o quedate unos segundos en silencio."
    const val TRANSCRIBING = "Estoy pasando lo que dijiste a texto…"
    const val HEARD = "Entendí:" // TODO(copy): escritorio dice «Entendí: «…». Ahora busco dónde se hace.»; «Ahora» está prohibido.
    const val EMPTY = "No te escuché bien. Probá de nuevo más cerca del micrófono, o escribilo en el buscador."
    const val FAILED = "No pude pasar tu voz a texto. Fue un problema mío, no tuyo. Probá de nuevo o escribilo en el buscador."
    const val BUSY = "Estoy recibiendo muchos pedidos. Esperá un momento y probá de nuevo, o escribilo en el buscador."
    const val OFF = "Hablar no está disponible por ahora. Podés escribir lo que buscás en el buscador."
    const val DENIED = "No tengo permiso para usar el micrófono. Podés darlo en la configuración del equipo, o escribir en el buscador."
    const val MIC = "No pude usar el micrófono. Fue un problema mío, no tuyo. Podés escribir lo que buscás en el buscador."

    fun problem(kind: VoiceProblem) = when (kind) {
        VoiceProblem.Empty -> EMPTY
        VoiceProblem.Failed -> FAILED
        VoiceProblem.Busy -> BUSY
        VoiceProblem.Off -> OFF
        VoiceProblem.Denied -> DENIED
        VoiceProblem.Mic -> MIC
    }
}

/** Lo que el inicio necesita del asistente de voz: el interruptor «Voz» y qué está haciendo. */
class AssistantVoiceUi(val on: Boolean, val onToggle: () -> Unit, val assistant: Assistant, val onStop: () -> Unit)

private val CircleBig = 112.dp
private val CircleDocked = 64.dp
private val Gutter = 16.dp
private const val MOVE_MS = 450

/**
 * Inicio (A-01): un buscador, no un chat. Si falta un dato, una pregunta por
 * vez debajo, con respuestas en botones y «No sé bien» (A-02).
 *
 * Dictado: un círculo grande «Hablar» abajo, en el centro. Al terminar de
 * grabar sube arriba a la izquierda y queda como encabezado, con lo que se
 * entendió al lado; debajo siguen la pregunta, las respuestas o los sitios.
 * Tocarlo de nuevo vuelve a escuchar; «Atrás» vuelve al buscador.
 * TODO(diseño): el dictado en teléfono (y la pantalla 33) no está diseñado; es una propuesta.
 * TODO(diseño): «Lo que hiciste antes» no está en el spike.
 */
@Composable
fun HomeScreen(
    state: Screen.Home,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onAnswer: (String) -> Unit,
    onOpenSite: (String) -> Unit,
    onVoice: () -> Unit,
    onMicDenied: () -> Unit,
    onCloseVoice: () -> Unit,
    onHome: () -> Unit,
    voice: AssistantVoiceUi,
) {
    val docked = state.docked
    BackHandler(enabled = docked) { onCloseVoice() }

    val context = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) onVoice() else onMicDenied()
    }
    val onCircle = {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted || state.voice is Voice.Listening) onVoice() else permission.launch(Manifest.permission.RECORD_AUDIO)
    }

    // Alto del círculo grande con su rótulo y su margen: el buscador deja ese lugar libre abajo.
    var restHeight by remember { mutableStateOf(0) }
    // Alto de la fila de «Inicio» arriba del encabezado: el círculo chico baja eso para caer en su lugar.
    var homeBarHeight by remember { mutableStateOf(0) }
    val density = LocalDensity.current
    val restH = with(density) { restHeight.toDp() }
    val homeBarH = with(density) { homeBarHeight.toDp() }

    Box(
        Modifier
            .fillMaxSize()
            .background(G.surface)
            .navigationBarsPadding()
            .imePadding(),
    ) {
        if (docked) {
            DockedContent(state, onAnswer, onOpenSite, onHome, voice, onHomeBarHeight = { homeBarHeight = it })
        } else {
            SearchContent(state, restH, onQueryChange, onSearch, onAnswer, onOpenSite, onHome, voice)
        }

        VoiceCircle(
            voice = state.voice,
            docked = docked,
            topInset = homeBarH,
            onClick = onCircle,
            // Solo en reposo: mientras sube, el tamaño cambia en cada cuadro.
            modifier = Modifier.onSizeChanged { if (!docked) restHeight = it.height },
        )
    }
}

/** Buscador con el círculo abajo, en su propio espacio: el contenido se desplaza arriba de él, nunca debajo. */
@Composable
private fun SearchContent(
    state: Screen.Home,
    circleHeight: Dp,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onAnswer: (String) -> Unit,
    onOpenSite: (String) -> Unit,
    onHome: () -> Unit,
    voice: AssistantVoiceUi,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            // El círculo tiene su propio espacio abajo: la lista termina antes y nunca queda tapada.
            .padding(bottom = circleHeight)
            .verticalScroll(rememberScrollState())
            .padding(start = Gutter, end = Gutter, top = 24.dp, bottom = Gutter),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Arriba: el logo a la izquierda y, si hay algo que dejar, «Inicio» a la derecha.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            GuiameLogo()
            Spacer(Modifier.weight(1f))
            VoiceSwitch(voice.on, voice.onToggle, onBar = false)
            if (state.question != null || state.sites.isNotEmpty() || state.error) {
                Spacer(Modifier.width(8.dp))
                HomeButton(onHome)
            }
        }

        GText(
            "¿Qué querés hacer hoy?",
            Modifier.semantics { heading() },
            size = G.headingHome,
            weight = FontWeight.SemiBold,
        )

        Column {
            SearchField(state.query, onQueryChange, onSearch, enabled = !state.loading && state.voice !is Voice.Listening)
            // Una sola región polite para lo que dice el dictado. Siempre montada para que se anuncie,
            // pero sin alto en reposo: así no deja un hueco entre el buscador y los resultados.
            Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                if (state.voice is Voice.Listening) {
                    GText(VoiceTexts.LISTENING, Modifier.padding(top = 16.dp), color = G.inkSecondary)
                }
            }
            // El aviso de un problema con el dictado va pegado al buscador, que es donde se puede seguir.
            (state.voice as? Voice.Problem)?.let { ErrorText(VoiceTexts.problem(it.kind), Modifier.padding(top = 8.dp)) }
        }

        AssistantStatus(voice.assistant, voice.onStop, reserve = voice.on && (state.question != null || state.sites.isNotEmpty()))
        Results(state, onAnswer, onOpenSite)
    }
}

/** El círculo ya subió: encabezado con lo que se entendió y, debajo, la búsqueda. */
@Composable
private fun DockedContent(
    state: Screen.Home,
    onAnswer: (String) -> Unit,
    onOpenSite: (String) -> Unit,
    onHome: () -> Unit,
    voice: AssistantVoiceUi,
    onHomeBarHeight: (Int) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        // Arriba de todo, para que se encuentre aunque la letra sea grande y haya que bajar:
        // el logo a la izquierda y «Inicio» a la derecha, a la misma altura.
        Row(
            Modifier
                .fillMaxWidth()
                .background(G.surfaceSoft)
                .onSizeChanged { onHomeBarHeight(it.height) }
                .padding(start = Gutter, end = Gutter, top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GuiameLogo()
            Spacer(Modifier.weight(1f))
            VoiceSwitch(voice.on, voice.onToggle, onBar = false)
            Spacer(Modifier.width(8.dp))
            HomeButton(onHome)
        }
        // El encabezado: a la izquierda, una copia invisible del círculo chico le
        // reserva el lugar final (el círculo de verdad llega animado y se dibuja encima).
        Row(
            Modifier
                .fillMaxWidth()
                .background(G.surfaceSoft)
                .padding(end = Gutter),
            // Arriba, como el círculo: con letra grande el texto puede ser más alto que él.
            verticalAlignment = Alignment.Top,
        ) {
            Box(Modifier.alpha(0f).clearAndSetSemantics {}.padding(Gutter)) {
                CircleBody(CircleDocked, docked = true, voice = Voice.Idle)
            }
            Column(
                Modifier
                    .weight(1f)
                    .padding(vertical = Gutter + 8.dp)
                    .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                when (val voice = state.voice) {
                    is Voice.Heard -> {
                        GText(VoiceTexts.HEARD, color = G.inkSecondary)
                        GText("«${voice.text}»", size = G.button, weight = FontWeight.SemiBold)
                    }
                    else -> GText(VoiceTexts.TRANSCRIBING, color = G.inkSecondary)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(2.dp).background(G.line))

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Gutter, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            AssistantStatus(voice.assistant, voice.onStop, reserve = voice.on && (state.question != null || state.sites.isNotEmpty()))
            Results(state, onAnswer, onOpenSite)
        }
    }
}

/** Cargando, error, la pregunta con sus respuestas y los sitios. */
@Composable
private fun Results(state: Screen.Home, onAnswer: (String) -> Unit, onOpenSite: (String) -> Unit) {
    if (state.voice == Voice.Transcribing || state.loading) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CircularProgressIndicator(color = G.brand)
            if (state.loading) GText("Estoy buscando…") // TODO(copy)
        }
    }

    if (state.error) ErrorText("Fue un problema mío, no tuyo.")

    state.question?.let { question ->
        GText(
            question,
            Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite },
            size = G.heading,
            weight = FontWeight.SemiBold,
        )
        for (answer in state.answers + "No sé bien") {
            SecondaryButton(answer, Modifier.heightIn(min = G.answerHeight)) { onAnswer(answer) }
        }
    }

    if (state.sites.isNotEmpty()) {
        for (site in state.sites) SiteButton(site) { onOpenSite(site.url) }
    }
}

/** Logo arriba a la izquierda: el ícono con ojos (guiame-icono.png), sobre fondo claro (R12). */
@Composable
private fun GuiameLogo() {
    Image(
        painter = painterResource(R.drawable.guiame_icono),
        contentDescription = "Guíame",
        modifier = Modifier.height(56.dp),
    )
}

/**
 * «Inicio»: vuelve al buscador vacío y deja la pregunta, los sitios o lo dictado.
 * Mismo texto que el botón de la barra del sitio; ícono Lucide «house» con el texto visible.
 */
@Composable
private fun HomeButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .heightIn(min = G.minTouch)
            .clip(G.radiusPill)
            .border(2.dp, G.borderControl, G.radiusPill)
            .background(G.surface)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Image(
            painterResource(R.drawable.ic_house),
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            colorFilter = ColorFilter.tint(G.brand),
        )
        GText("Inicio", size = G.button, weight = FontWeight.SemiBold, color = G.brand)
    }
}

@Composable
private fun ErrorText(text: String, modifier: Modifier = Modifier) {
    GText(
        text,
        modifier.semantics { liveRegion = LiveRegionMode.Assertive },
        color = G.error,
        weight = FontWeight.SemiBold,
    )
}

/**
 * El círculo «Hablar». En reposo, grande abajo en el centro; escuchando, un
 * halo crece con la voz y el rótulo dice «Terminar». Al terminar se achica y
 * sube a la esquina de arriba (posición y tamaño animados).
 */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.VoiceCircle(
    voice: Voice,
    docked: Boolean,
    topInset: Dp,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val listening = voice is Voice.Listening
    val top by animateDpAsState(if (docked) topInset else 0.dp, tween(MOVE_MS), label = "top")
    val x by animateFloatAsState(if (docked) -1f else 0f, tween(MOVE_MS), label = "x")
    val y by animateFloatAsState(if (docked) -1f else 1f, tween(MOVE_MS), label = "y")
    val size by animateDpAsState(if (docked) CircleDocked else CircleBig, tween(MOVE_MS), label = "size")

    Box(
        modifier
            .align(BiasAlignment(x, y))
            .padding(top = top)
            .padding(Gutter)
            .clip(G.radiusControl)
            .clickable(role = Role.Button, enabled = voice != Voice.Transcribing, onClick = onClick)
            .semantics(mergeDescendants = true) {
                // El nombre accesible incluye el texto visible (2.5.3).
                contentDescription = if (listening) VoiceTexts.STOP else VoiceTexts.SPEAK_NAME
                if (listening) stateDescription = VoiceTexts.LISTENING
            },
    ) {
        CircleBody(size, docked, voice)
    }
}

/** El círculo con el micrófono y su rótulo visible; escuchando, un halo crece con la voz. */
@Composable
private fun CircleBody(size: Dp, docked: Boolean, voice: Voice) {
    val halo by animateFloatAsState(if (voice is Voice.Listening) 1.08f + voice.level * 0.35f else 1f, tween(120), label = "halo")
    Column(
        Modifier.padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(if (docked) 4.dp else 10.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            // Halo: anillo azul suave detrás del círculo, solo escuchando (no cambia el tamaño medido).
            if (voice is Voice.Listening) {
                Box(
                    Modifier
                        .size(size)
                        .scale(halo)
                        .clip(CircleShape)
                        .background(G.actionSoft),
                )
            }
            Box(
                Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(G.gradientAction)
                    .border(3.dp, G.surface, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Image(painterResource(R.drawable.ic_mic), contentDescription = null, Modifier.size(size * 0.4f))
            }
        }
        GText(
            if (voice is Voice.Listening) VoiceTexts.STOP else VoiceTexts.SPEAK,
            size = if (docked) G.minimum else G.button,
            weight = FontWeight.SemiBold,
            color = G.brand,
            align = TextAlign.Center,
        )
    }
}

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit, onSearch: () -> Unit, enabled: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = G.primaryHeight)
            .clip(G.radiusPill)
            .border(2.dp, G.borderControl, G.radiusPill)
            .background(G.surface)
            .padding(start = 20.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        BasicTextField(
            value = value,
            // Varias líneas para que la letra grande entre, pero Enter envía (no agrega un salto).
            onValueChange = { text ->
                onChange(text.replace("\n", ""))
                if ('\n' in text) onSearch()
            },
            enabled = enabled,
            modifier = Modifier
                .weight(1f)
                .semantics { contentDescription = "¿Qué querés hacer hoy?" },
            textStyle = TextStyle(fontFamily = G.poppins, fontSize = G.button, color = G.ink),
            cursorBrush = SolidColor(G.brand),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { onSearch() }),
        )
        // Con algo escrito, la píldora dice «Enviar»; «Hablar» es el círculo de abajo.
        if (value.isNotBlank()) {
            Box(
                Modifier
                    .heightIn(min = G.minTouch)
                    .clip(G.radiusPill)
                    .background(G.gradientAction)
                    .clickable(role = Role.Button, onClick = onSearch)
                    .padding(horizontal = 18.dp, vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                GText("Enviar", size = G.button, weight = FontWeight.SemiBold, color = G.surface)
            }
        }
    }
}

@Composable
private fun SiteButton(site: SiteChoice, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(G.radiusControl)
            .border(2.dp, G.borderControl, G.radiusControl)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        GText(site.title, size = G.button, weight = FontWeight.SemiBold)
        site.reason?.let { GText(it, color = G.inkSecondary) }
    }
}
