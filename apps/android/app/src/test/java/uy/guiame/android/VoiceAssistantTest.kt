package uy.guiame.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceAssistantTest {
    private val options = listOf(Choice("Sacar un turno"), Choice("Ver mis turnos"), Choice("Cancelar un turno"))

    @Test
    fun `reconoce la opción por su nombre, por número y por ordinal`() {
        assertEquals(ChoiceMatch.Match(1), matchChoice("quiero ver mis turnos", options))
        assertEquals(ChoiceMatch.Match(0), matchChoice("la primera", options))
        assertEquals(ChoiceMatch.Match(1), matchChoice("la dos", options))
        assertEquals(ChoiceMatch.Match(2), matchChoice("la última", options))
    }

    @Test
    fun `«primera vez» habla de un trámite, no de la opción uno`() {
        assertEquals(ChoiceMatch.None, matchChoice("es la primera vez que saco la cédula", options))
    }

    @Test
    fun `«sí» elige la opción afirmativa y «no sé» solo, «No sé bien»`() {
        val click = listOf(Choice("Tocá «Continuar» por mí", kind = Choice.Kind.Yes))
        assertEquals(ChoiceMatch.Match(0), matchChoice("Sí, dale", click))
        assertEquals(ChoiceMatch.None, matchChoice("no", click))

        val answers = listOf(Choice("Con un médico"), Choice(VoiceTexts.UNSURE, kind = Choice.Kind.Unsure))
        assertEquals(ChoiceMatch.Match(1), matchChoice("no sé", answers))
        // «no sé cómo renovar» nombra una tarea: no es «No sé bien».
        assertEquals(ChoiceMatch.None, matchChoice("no sé cómo renovar la cédula", answers))
    }

    @Test
    fun `empate entre dos opciones parecidas`() {
        assertEquals(ChoiceMatch.Tie, matchChoice("turno", listOf(Choice("Turno médico"), Choice("Turno banco"))))
    }

    @Test
    fun `la barrera nunca deja tocar acciones irreversibles`() {
        for (text in listOf("Hacé clic en «Pagar».", "Tocá «Confirmar compra»", "Eliminar cuenta", "Dar de baja", "Transferir", "Firmá el documento", "checkout")) {
            assertTrue(text, isIrreversibleAction(text))
        }
        for (text in listOf("Hacé clic en «Continuar».", "Tocá «Siguiente»", "Abrí «Trámites»")) {
            assertFalse(text, isIrreversibleAction(text))
        }
    }

    @Test
    fun `los textos leídos son los de Guíame, con la oferta de tocar solo si corresponde`() {
        assertEquals(
            "¿Qué querés hacer acá? Encontré estas opciones en esta página: Sacar un turno, Ver mis turnos o Cancelar un turno.",
            optionsSpeech(options.map { it.label }),
        )
        assertEquals("Hacé clic en «Continuar». Si querés, lo toco yo.", stepSpeech("Hacé clic en «Continuar».", sensitive = false, offerClick = true))
        assertEquals(
            "Escribí tu clave en «Clave». Lo escribís vos. Yo no lo veo ni lo guardo.",
            stepSpeech("Escribí tu clave en «Clave».", sensitive = true, offerClick = false),
        )
        assertEquals("Tocá «Continuar» por mí", clickForMeLabel("Hacé clic en «Continuar»."))
        assertEquals("Tocalo por mí", clickForMeLabel("Seguí."))
    }

    @Test
    fun `lo leído nunca pasa el máximo del servidor ni corta palabras`() {
        val long = List(200) { "palabra" }.joinToString(" ")
        val clipped = clipForSpeech(long)
        assertTrue(clipped.length <= VoiceTexts.MAX_CHARS)
        assertTrue(clipped.split(' ').all { it == "palabra" })
    }
}
