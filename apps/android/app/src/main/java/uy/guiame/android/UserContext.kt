package uy.guiame.android

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Locale

/**
 * Datos del teléfono que acompañan cada /v1/interpret (`UserContext` de
 * `packages/contracts`), como hace escritorio (`user-context.ts`): el idioma,
 * la zona horaria y el país de la configuración regional. Así Claude prioriza
 * los sitios oficiales del país y no pregunta «¿En qué país?».
 *
 * Privacidad: solo datos de la configuración del teléfono, nunca la ubicación
 * ni la dirección. Lo que no tiene el formato del contrato no se manda.
 */
object UserContext {
    private val LANGUAGE = Regex("^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$")
    private val TIME_ZONE = Regex("^[A-Za-z0-9_+-]+(?:/[A-Za-z0-9_+-]+)*$")
    private val COUNTRY = Regex("^[A-Z]{2}$")

    /** null si no hay nada válido para mandar. */
    fun of(locale: Locale, timeZoneId: String?): JsonObject? {
        val language = locale.toLanguageTag().takeIf { it.length <= 35 && LANGUAGE.matches(it) && it != "und" }
        val timeZone = timeZoneId?.takeIf { it.length <= 64 && TIME_ZONE.matches(it) }
        val country = locale.country.takeIf { COUNTRY.matches(it) }
        if (language == null && timeZone == null && country == null) return null
        return buildJsonObject {
            country?.let { put("location", buildJsonObject { put("country", it) }) }
            language?.let { put("language", it) }
            timeZone?.let { put("timeZone", it) }
        }
    }
}
