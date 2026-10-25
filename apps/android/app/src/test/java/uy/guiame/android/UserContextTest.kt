package uy.guiame.android

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

class UserContextTest {
    @Test
    fun `manda idioma, zona horaria y país del teléfono`() {
        val user = UserContext.of(Locale.forLanguageTag("es-UY"), "America/Montevideo")!!
        assertEquals("es-UY", user["language"]!!.jsonPrimitive.content)
        assertEquals("America/Montevideo", user["timeZone"]!!.jsonPrimitive.content)
        assertEquals("UY", user["location"]!!.jsonObject["country"]!!.jsonPrimitive.content)
    }

    @Test
    fun `sin país en la configuración no inventa uno`() {
        val user = UserContext.of(Locale.forLanguageTag("es"), "America/Montevideo")!!
        assertFalse(user.containsKey("location"))
        assertEquals("es", user["language"]!!.jsonPrimitive.content)
    }

    @Test
    fun `lo que no cumple el formato del contrato no se manda`() {
        assertNull(UserContext.of(Locale.ROOT, "zona horaria rara!"))
        val user = UserContext.of(Locale.forLanguageTag("es-UY"), "../../etc")!!
        assertFalse(user.containsKey("timeZone"))
    }

    @Test
    fun `solo datos de la configuración, nunca ubicación ni dirección`() {
        val user = UserContext.of(Locale.forLanguageTag("es-UY"), "America/Montevideo")!!
        assertEquals(setOf("location", "language", "timeZone"), user.keys)
        assertEquals(setOf("country"), user["location"]!!.jsonObject.keys)
    }

    @Test
    fun `saca las respuestas de duda repetidas, no las que nombran algo`() {
        assertEquals(
            listOf("Jubilación común", "Por edad avanzada", "No sé cuál me corresponde"),
            withoutUnsure(listOf("Jubilación común", "Por edad avanzada", "Todavía no sé", "No estoy seguro", "No sé cuál me corresponde")),
        )
    }
}
