package uy.guiame.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.lerp
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import uy.guiame.android.R

/**
 * Entrada de la app: el logo arranca en el centro, donde lo deja la pantalla
 * de inicio de Android (mismo tamaño), y se traslada y achica hasta su lugar
 * arriba a la izquierda del inicio mientras aparece el resto. Solo al abrir
 * la app, no al rotar ni al volver.
 *
 * `done`: terminó (el logo de verdad ya se ve). `target`: dónde está el logo
 * del inicio, en coordenadas de la ventana; lo informa `GuiameLogo`.
 * Con las animaciones apagadas en el teléfono, termina enseguida.
 */
class LogoIntro(val done: MutableState<Boolean>, val target: MutableState<Rect?>)

val LocalLogoIntro = compositionLocalOf<LogoIntro?> { null }

/**
 * Alto con el que Android muestra el logo en su pantalla de inicio: el ícono
 * va a 288 dp y el logo ocupa 52/108 de él (ícono adaptable). Medido en el
 * emulador Pixel 8: 137 dp.
 */
private val SplashLogo = 137.dp
private const val HOLD_MS = 250L
private const val MOVE_MS = 700

@Composable
fun LogoIntroOverlay(intro: LogoIntro) {
    if (intro.done.value) return
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        // Si el inicio no aparece (por ejemplo, la app vuelve con un sitio abierto), no hay adónde ir.
        val found = withTimeoutOrNull(1_500) { while (intro.target.value == null) delay(16) }
        if (found != null) {
            delay(HOLD_MS)
            progress.animateTo(1f, tween(MOVE_MS, easing = FastOutSlowInEasing))
        }
        intro.done.value = true
    }

    val density = LocalDensity.current
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .clearAndSetSemantics {}
            // El fondo blanco se desvanece y deja ver el inicio.
            .background(G.surface.copy(alpha = 1f - progress.value)),
    ) {
        val target = intro.target.value
        val p = progress.value
        val startSize = SplashLogo
        val endSize = target?.let { with(density) { it.height.toDp() } } ?: startSize
        val size = lerp(startSize, endSize, p)
        // Proporción del logo (264 × 261 px): el ancho sale del alto.
        val width = size * (264f / 261f)
        val startX = maxWidth / 2
        val startY = maxHeight / 2
        val endX = target?.let { with(density) { it.center.x.toDp() } } ?: startX
        val endY = target?.let { with(density) { it.center.y.toDp() } } ?: startY
        val x = lerp(startX, endX, p) - width / 2
        val y = lerp(startY, endY, p) - size / 2
        Image(
            painter = painterResource(R.drawable.guiame_icono),
            contentDescription = null,
            modifier = Modifier.offset(x, y).size(width, size),
        )
    }
}
