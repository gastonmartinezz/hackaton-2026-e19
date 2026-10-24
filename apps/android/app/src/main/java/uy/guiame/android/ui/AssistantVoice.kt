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
 * TODO(diseño): el interruptor no tiene pantalla en design/ para teléfono.
 */
@Composable
fun VoiceSwitch(on: Boolean, onToggle: () -> Unit, onBar: Boolean) {
    val ink = if (onBar) G.surface else G.brand
    Row(
        Modifier
            .heightIn(min = G.minTouch)
            .clip(G.radiusPill)
            .border(2.dp, if (onBar) G.surface else G.borderControl, G.radiusPill)
            .background(if (on) (if (onBar) G.surface else G.actionSoft) else androidx.compose.ui.graphics.Color.Transparent)
            .clickable(role = Role.Switch, onClick = onToggle)
            .semantics { stateDescription = if (on) "Prendida" else "Apagada" } // TODO(copy)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val color = if (on && onBar) G.brand else ink
        Image(painterResource(R.drawable.ic_volume), contentDescription = null, Modifier.size(18.dp), colorFilter = ColorFilter.tint(color))
        GText("Voz", size = G.minimum, weight = FontWeight.SemiBold, color = color)
    }
}

private val StatusHeight = 64.dp

/**
 * Qué está haciendo el asistente de voz: escuchando la respuesta (con el
 * texto de escritorio) o pasándola a texto. Mientras lee o escucha, «Detener»
 * lo corta y quedan los botones.
 * TODO(diseño): la pantalla 33 («escuchando») no está diseñada.
 */
@Composable
fun AssistantStatus(assistant: Assistant, onStop: () -> Unit, reserve: Boolean) {
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
                    Modifier.size(36.dp).clip(CircleShape).background(G.gradientAction),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(painterResource(R.drawable.ic_mic), contentDescription = null, Modifier.size(18.dp))
                }
                GText(VoiceTexts.LISTENING, Modifier.weight(1f), color = G.inkSecondary)
            }
            Assistant.Thinking -> {
                CircularProgressIndicator(Modifier.size(28.dp), color = G.brand, strokeWidth = 3.dp)
                GText("Estoy pasando lo que dijiste a texto…", Modifier.weight(1f), color = G.inkSecondary)
            }
            Assistant.Speaking -> Box(Modifier.weight(1f))
            Assistant.Quiet -> Unit
        }
        Box(
            Modifier
                .heightIn(min = G.minTouch)
                .clip(G.radiusPill)
                .clickable(role = Role.Button, onClick = onStop)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            GText("Detener", color = G.brand, weight = FontWeight.SemiBold) // SPEECH_TEXTS.stop de escritorio
        }
    }
}
