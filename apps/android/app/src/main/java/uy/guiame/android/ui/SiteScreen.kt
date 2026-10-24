package uy.guiame.android.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import uy.guiame.android.Card
import uy.guiame.android.GuiameViewModel
import uy.guiame.android.PageBridge
import uy.guiame.android.R
import uy.guiame.android.Screen

/**
 * Sitio abierto. En teléfono la tarjeta flotante (R4) pasa a ser una tarjeta
 * fija abajo y el sitio ocupa el espacio de arriba: así nunca tapa el control
 * resaltado, porque el agente lo desplaza al centro de la parte visible.
 * TODO(diseño): no hay diseño de teléfono para la tarjeta.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun SiteScreen(state: Screen.Site, vm: GuiameViewModel, onTextSize: () -> Unit) {
    val context = LocalContext.current
    var canGoBack by remember { mutableStateOf(false) }
    var collapsed by remember { mutableStateOf(false) }

    val webView = remember {
        WebView(context).apply {
            webViewClient = object : WebViewClient() {
                // Solo https dentro del WebView (el backend verifica las URLs de la misma forma).
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.scheme != "https"

                override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                    canGoBack = view.canGoBack()
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    canGoBack = view.canGoBack()
                    bridgeOf(view)?.onPageFinished()
                }
            }
        }
    }
    val bridge = remember(webView) {
        PageBridge(
            webView,
            object : PageBridge.Listener {
                override fun onPageReady(origin: String) = vm.onPageReady()
                override fun onInteraction(elementId: String, event: String) = vm.onInteraction(elementId)
                override fun onPageChanged() = Unit
            },
        ).also {
            it.install()
            webView.tag = it
        }
    }

    DisposableEffect(bridge) {
        vm.attach(bridge)
        onDispose {
            vm.attach(null)
            webView.destroy()
        }
    }
    LaunchedEffect(state.url) { webView.loadUrl(state.url) }
    // La letra del sitio sigue al «Tamaño de letra» de Guíame.
    LaunchedEffect(vm.textScale) { webView.settings.textZoom = (vm.textScale * 100).toInt() }

    BackHandler {
        if (webView.canGoBack()) webView.goBack() else vm.goHome()
    }

    val maxCard = LocalConfiguration.current.screenHeightDp.dp * 0.5f

    Column(Modifier.fillMaxSize().background(G.surface)) {
        Bar(onHome = vm::goHome, onTextSize = onTextSize)
        AndroidView(factory = { webView }, modifier = Modifier.weight(1f).fillMaxWidth())
        HelpCard(
            card = state.card,
            collapsed = collapsed,
            onToggle = { collapsed = !collapsed },
            vm = vm,
            modifier = Modifier.heightIn(max = maxCard),
        )
    }
}

private fun bridgeOf(view: WebView): PageBridge? = view.tag as? PageBridge

@Composable
private fun Bar(onHome: () -> Unit, onTextSize: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = G.barHeight)
            .background(G.gradientBar)
            .padding(horizontal = 12.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Logo de la barra: el ícono con ojos, al mismo alto que tenía la palabra (decisión de Gastón, 24/10/2026).
        // TODO(diseño): CLAUDE.md §4 pide guiame-blanco.png acá; el ícono con contenedor celeste va sobre fondo claro (R12).
        Image(
            painter = painterResource(R.drawable.guiame_icono),
            contentDescription = "Guíame",
            modifier = Modifier.height(32.dp),
        )
        Box(Modifier.weight(1f))
        BarButton("Inicio", onHome)
        BarButton("Letra", onTextSize) // TODO(copy): en escritorio dice «Tamaño de letra»; no entra en teléfono.
    }
}

@Composable
private fun BarButton(text: String, onClick: () -> Unit) {
    Box(
        Modifier
            .heightIn(min = G.minTouch)
            .clip(G.radiusPill)
            .border(2.dp, G.surface, G.radiusPill)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        GText(text, size = G.minimum, weight = FontWeight.SemiBold, color = G.surface)
    }
}

@Composable
private fun HelpCard(card: Card, collapsed: Boolean, onToggle: () -> Unit, vm: GuiameViewModel, modifier: Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(G.radiusCard)
            .border(1.dp, G.line, G.radiusCard)
            .background(G.surface)
            .navigationBarsPadding(),
    ) {
        // Asa para achicar la tarjeta y ver más del sitio (A-12, tarjeta achicada).
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = G.minTouch)
                .background(G.gradientCardHead)
                .clickable(role = Role.Button, onClick = onToggle)
                .padding(horizontal = 20.dp, vertical = 8.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            GText(if (collapsed) "Mostrar ayuda" else "Achicar", color = G.brand, weight = FontWeight.SemiBold) // TODO(copy)
        }
        if (collapsed) {
            // Achicada: solo la instrucción, para no perderla de vista.
            (card as? Card.Step)?.let {
                GText(it.step.instruction, Modifier.padding(horizontal = 20.dp, vertical = 12.dp), size = G.button, weight = FontWeight.SemiBold)
            }
            return@Column
        }
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 20.dp, top = 4.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            CardBody(card, vm)
        }
    }
}

@Composable
private fun CardBody(card: Card, vm: GuiameViewModel) {
    // Una sola región que anuncia lo nuevo, sin mover el foco (CLAUDE.md §7).
    val announce = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
    when (card) {
        Card.Looking -> Waiting("Estoy mirando la página…", announce)
        Card.Checking -> Waiting("Estoy fijándome si funcionó…", announce)
        is Card.Options -> {
            GText("¿Qué querés hacer acá?", announce.semantics { heading() }, size = G.heading, weight = FontWeight.SemiBold)
            for (option in card.options) SecondaryButton(option.title) { vm.chooseOption(option) }
        }
        is Card.Step -> {
            if (card.doneCount > 0) GText("Pasos hechos: ${card.doneCount}", color = G.inkSecondary) // TODO(copy)
            GText(card.step.instruction, announce, size = G.instruction, weight = FontWeight.SemiBold)
            when {
                card.sensitive -> GText("Lo escribís vos. Yo no lo veo ni lo guardo.", color = G.inkSecondary)
                card.step.field != null || card.step.waitFor == "userConfirmation" ->
                    // TODO: el dictado (preguntar en voz alta y escribir) no está en el spike.
                    PrimaryButton("Está bien, seguir", onClick = vm::confirmStep)
                card.step.element == null -> PrimaryButton("Está bien, seguir", onClick = vm::confirmStep)
            }
        }
        is Card.Done -> {
            GText("Listo.", announce, size = G.heading, weight = FontWeight.SemiBold, color = G.success) // TODO(copy)
            GText("«${card.evidence}»", color = G.ink)
            PrimaryButton("Volver al inicio", onClick = vm::goHome) // TODO(copy)
        }
        Card.AskFinished -> {
            GText("¿Pudiste terminar?", announce, size = G.heading, weight = FontWeight.SemiBold)
            PrimaryButton("Sí") { vm.finished(true) } // TODO(copy)
            SecondaryButton("Todavía no") { vm.finished(false) }
        }
        Card.Error -> {
            GText("No pude leer esta página", announce.semantics { liveRegion = LiveRegionMode.Assertive }, size = G.heading, weight = FontWeight.SemiBold)
            GText("Fue un problema mío, no tuyo.", color = G.inkSecondary)
            PrimaryButton("Volver al inicio", onClick = vm::goHome) // TODO(copy)
        }
    }
}

@Composable
private fun Waiting(text: String, modifier: Modifier) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        CircularProgressIndicator(color = G.brand)
        GText(text, modifier, size = G.button, weight = FontWeight.SemiBold)
    }
}
