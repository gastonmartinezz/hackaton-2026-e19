package uy.guiame.android.ui

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import uy.guiame.android.Screen
import uy.guiame.android.SiteChoice

/**
 * Inicio (A-01): un buscador, no un chat. Si falta un dato, una pregunta por
 * vez debajo, con respuestas en botones y «No sé bien» (A-02).
 * TODO(diseño): «Hablar» (voz) y «Lo que hiciste antes» no están en el spike.
 */
@Composable
fun HomeScreen(
    state: Screen.Home,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onAnswer: (String) -> Unit,
    onOpenSite: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(G.surface)
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        GText(
            "¿Qué querés hacer hoy?",
            Modifier.semantics { heading() },
            size = G.headingHome,
            weight = FontWeight.SemiBold,
        )

        SearchField(state.query, onQueryChange, onSearch, enabled = !state.loading)

        if (state.loading) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(color = G.brand)
                GText("Estoy buscando…") // TODO(copy)
            }
        }

        if (state.error) {
            GText(
                "Fue un problema mío, no tuyo.",
                Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                color = G.error,
                weight = FontWeight.SemiBold,
            )
        }

        state.question?.let { question ->
            Spacer(Modifier.height(8.dp))
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
            Spacer(Modifier.height(8.dp))
            for (site in state.sites) SiteButton(site) { onOpenSite(site.url) }
        }
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
        // La píldora dice «Enviar» con algo escrito; «Hablar» (voz) queda para después del spike.
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
