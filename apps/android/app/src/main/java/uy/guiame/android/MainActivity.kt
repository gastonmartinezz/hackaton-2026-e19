package uy.guiame.android

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import uy.guiame.android.ui.AssistantVoiceUi
import uy.guiame.android.ui.G
import uy.guiame.android.ui.LocalLogoIntro
import uy.guiame.android.ui.LogoIntro
import uy.guiame.android.ui.LogoIntroOverlay
import uy.guiame.android.ui.GText
import uy.guiame.android.ui.HomeScreen
import uy.guiame.android.ui.PrimaryButton
import uy.guiame.android.ui.SecondaryButton
import uy.guiame.android.ui.SiteScreen

class MainActivity : ComponentActivity() {
    private val vm: GuiameViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // La pantalla de inicio de Android se va sin fundido: la entrada del logo (LogoIntro) arranca
        // con el logo en el mismo lugar y tamaño, así que el cambio no se nota.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) splashScreen.setOnExitAnimationListener { it.remove() }
        // Arranca con la letra que la persona ya eligió en el teléfono, sin bajar de 1.2× (los diseños).
        if (savedInstanceState == null) vm.textScale = resources.configuration.fontScale.coerceIn(1.2f, 2.0f)

        setContent {
            // «Tamaño de letra» es la única fuente: reemplaza la escala del sistema en toda la capa Guíame.
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = vm.textScale)) {
                var textSizeOpen by remember { mutableStateOf(false) }
                // Entrada del logo: solo al abrir la app (rememberSaveable: no se repite al rotar).
                val introDone = rememberSaveable { mutableStateOf(false) }
                val intro = remember { LogoIntro(introDone, mutableStateOf(null)) }
                Box(Modifier.fillMaxSize()) {
                CompositionLocalProvider(LocalLogoIntro provides intro) {
                Column(Modifier.statusBarsPadding()) {
                    when (val screen = vm.screen) {
                        is Screen.Home -> HomeScreen(
                            state = screen,
                            onQueryChange = vm::onQueryChange,
                            onSearch = vm::search,
                            onAnswer = vm::answer,
                            onOpenSite = vm::openSite,
                            onVoice = vm::toggleVoice,
                            onMicDenied = vm::micDenied,
                            onCloseVoice = vm::closeVoice,
                            onHome = vm::goHome,
                            voice = AssistantVoiceUi(vm.voiceOn, vm::toggleVoiceMode, vm.assistant, vm::stopVoice),
                        )
                        is Screen.Site -> SiteScreen(screen, vm, onTextSize = { textSizeOpen = true })
                    }
                }
                }
                LogoIntroOverlay(intro)
                }
                if (textSizeOpen) TextSizeDialog(vm.textScale, { vm.textScale = it }, { textSizeOpen = false })
            }
        }
    }
}

/** «Tamaño de letra»: cuatro tamaños grandes, sin deslizador (más fácil de tocar). */
@androidx.compose.runtime.Composable
private fun TextSizeDialog(current: Float, onPick: (Float) -> Unit, onClose: () -> Unit) {
    val sizes = listOf(1.0f to "Normal", 1.2f to "Grande", 1.5f to "Más grande", 2.0f to "Enorme") // TODO(copy)
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = G.surface,
        title = { GText("Tamaño de letra", size = G.heading, weight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for ((scale, label) in sizes) {
                    val text = if (scale == current) "$label (elegido)" else label
                    SecondaryButton(text) { onPick(scale) }
                }
            }
        },
        confirmButton = { PrimaryButton("Listo", onClick = onClose) }, // TODO(copy)
    )
}
