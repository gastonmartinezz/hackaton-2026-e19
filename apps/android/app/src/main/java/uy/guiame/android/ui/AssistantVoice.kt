package uy.guiame.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import uy.guiame.android.Assistant
import uy.guiame.android.R
import uy.guiame.android.VoiceTexts

/**
 * Interruptor «Voz» (como escritorio): con el modo voz, Guíame lee las
 * opciones y las instrucciones y escucha la respuesta. Prendido se ve lleno;
 * apagado, solo con borde. `onBar`: sobre la barra azul (texto blanco).
 *
 * Mientras Guíame lee o escucha (`busy`), la misma píldora dice «Detener» y
 * lo corta: así no hace falta otro botón abajo que ocupe lugar.
 * TODO(diseño): el interruptor no tiene pantalla en design/ para teléfono.
 */
@Composable
fun VoiceSwitch(on: Boolean, onToggle: () -> Unit, onBar: Boolean, busy: Boolean = false, onStop: () -> Unit = {}) {
    val ink = if (onBar) G.surface else G.brand
    val filled = on || busy
    Row(
        Modifier
            .heightIn(min = G.minTouch)
            .clip(G.radiusPill)
            .border(2.dp, if (onBar) G.surface else G.borderControl, G.radiusPill)
            .background(if (filled) (if (onBar) G.surface else G.actionSoft) else androidx.compose.ui.graphics.Color.Transparent)
            .then(
                if (busy) Modifier.clickable(role = Role.Button, onClick = onStop)
                else Modifier.clickable(role = Role.Switch, onClick = onToggle)
                    .semantics { stateDescription = if (on) "Prendida" else "Apagada" }, // TODO(copy)
            )
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val color = if (filled && onBar) G.brand else ink
        val icon = if (busy) R.drawable.ic_square else R.drawable.ic_volume
        Image(painterResource(icon), contentDescription = null, Modifier.size(18.dp), colorFilter = ColorFilter.tint(color))
        // «Detener»: SPEECH_TEXTS.stop de escritorio.
        GText(if (busy) "Detener" else "Voz", size = G.minimum, weight = FontWeight.SemiBold, color = color)
    }
}

private val StatusHeight = 44.dp

/**
 * Qué está haciendo el asistente de voz, en una línea chica: escuchando la
 * respuesta (con el texto de escritorio) o pasándola a texto. Para cortarlo
 * está «Detener» arriba, en la píldora «Voz».
 * TODO(diseño): la pantalla 33 («escuchando») no está diseñada.
 */
@Composable
fun AssistantStatus(assistant: Assistant, reserve: Boolean) {
    // Con la voz prendida el lugar queda reservado aunque no suene nada: así los
    // botones no se mueven cuando aparece o desaparece «Te escucho…».
    if (assistant == Assistant.Quiet) {
        if (reserve) Box(Modifier.heightIn(min = StatusHeight))
        return
    }
    Row(
        Modifier.heightIn(min = StatusHeight).semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        when (assistant) {
            is Assistant.Listening -> {
                Box(
                    Modifier.size(28.dp).clip(CircleShape).background(G.gradientAction),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(painterResource(R.drawable.ic_mic), contentDescription = null, Modifier.size(15.dp))
                }
                GText(VoiceTexts.LISTENING, Modifier.weight(1f), color = G.inkSecondary)
            }
            Assistant.Thinking -> {
                CircularProgressIndicator(Modifier.size(24.dp), color = G.brand, strokeWidth = 3.dp)
                GText("Estoy pasando lo que dijiste a texto…", Modifier.weight(1f), color = G.inkSecondary)
            }
            Assistant.Speaking, Assistant.Quiet -> Unit
        }
    }
}
