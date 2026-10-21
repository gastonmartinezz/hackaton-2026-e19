package uy.guiame.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Texto con Poppins y el color de tinta por defecto. */
@Composable
fun GText(
    text: String,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.TextUnit = G.support,
    weight: FontWeight = FontWeight.Normal,
    color: androidx.compose.ui.graphics.Color = G.ink,
    align: TextAlign? = null,
) {
    Text(
        text = text,
        modifier = modifier,
        style = TextStyle(fontFamily = G.poppins, fontSize = size, fontWeight = weight, color = color, lineHeight = size * 1.3f),
        textAlign = align,
    )
}

/** .g-primary: una sola acción principal por vista (R2). Crece con el texto: nunca corta. */
@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = G.primaryHeight)
            .clip(G.radiusControl)
            .background(G.gradientAction)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        GText(text, size = G.button, weight = FontWeight.SemiBold, color = G.surface, align = TextAlign.Center)
    }
}

/** .g-secondary y respuestas: borde visible, fondo blanco. */
@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = G.secondaryHeight)
            .clip(G.radiusControl)
            .border(2.dp, G.borderControl, G.radiusControl)
            .background(G.surface)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        GText(text, size = G.button, weight = FontWeight.SemiBold)
    }
}
