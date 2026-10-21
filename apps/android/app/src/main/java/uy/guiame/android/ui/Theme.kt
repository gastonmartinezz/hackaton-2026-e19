package uy.guiame.android.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uy.guiame.android.R

/**
 * Valores de design/tokens/tokens.json. Los colores y radios son los mismos;
 * los tamaños de letra están adaptados a teléfono (los de escritorio están
 * pensados para 1440×900 a 1.2×).
 * TODO(diseño): no hay diseño de teléfono; estos tamaños son una propuesta.
 */
object G {
    val ink = Color(0xFF0B1B3F)
    val inkSecondary = Color(0xFF47557A)
    val borderControl = Color(0xFF7A8CC9)
    val line = Color(0xFFDCE4FA)
    val surface = Color(0xFFFFFFFF)
    val surfaceSoft = Color(0xFFF2F5FF)
    val actionSoft = Color(0xFFE6EDFF)
    val brand = Color(0xFF1D4ED8)
    val brandDark = Color(0xFF1638B8)
    val brandLight = Color(0xFF3B74FF)
    val success = Color(0xFF13693D)
    val error = Color(0xFFB42318)

    val gradientAction = Brush.linearGradient(listOf(brandLight, brand, brandDark))
    val gradientBar = Brush.horizontalGradient(listOf(Color(0xFF3A9BFF), Color(0xFF2B86FF), Color(0xFF1F74F0)))
    val gradientCardHead = Brush.verticalGradient(listOf(Color(0xFFEAF3FF), surface))

    val radiusControl = RoundedCornerShape(18.dp)
    val radiusCard = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
    val radiusPill = RoundedCornerShape(999.dp)

    val barHeight = 64.dp
    val barControl = 54.dp
    val primaryHeight = 64.dp
    val secondaryHeight = 58.dp
    val answerHeight = 64.dp
    val minTouch = 48.dp

    val poppins = FontFamily(
        Font(R.font.poppins_regular, FontWeight.Normal),
        Font(R.font.poppins_semibold, FontWeight.SemiBold),
        Font(R.font.poppins_bold, FontWeight.Bold),
    )

    // Escritorio: instrucción 32, título 31, botón 22, apoyo 22, mínimo 20 (px a 1.2×).
    val instruction = 24.sp
    val heading = 26.sp
    val headingHome = 30.sp
    val button = 19.sp
    val support = 18.sp
    val minimum = 17.sp
}
