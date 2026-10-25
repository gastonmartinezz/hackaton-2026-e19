package uy.guiame.android

import java.text.Normalizer

/**
 * Modo voz del asistente: qué se lee en voz alta, cómo se reconoce lo que la
 * persona contesta y cuándo Guíame puede ofrecer tocar un botón. Funciones
 * puras (sin Android), copiadas de escritorio:
 * - textos: `apps/desktop/src/renderer/src/speech/speechText.ts`
 * - respuestas: `apps/desktop/src/renderer/src/voice/matchChoice.ts`
 * - barrera: `isIrreversibleAction` de `packages/guidance`
 *
 * Privacidad: solo se lee texto escrito por Guíame (instrucción, pregunta,
 * opciones). Nunca valores de formularios ni citas de la página, como la
 * evidencia de «Listo».
 */
object VoiceTexts {
    /** Textos de escritorio (SPEECH_TEXTS y ANSWER_TEXTS). TODO(copy): provisorios, pendientes de diseño. */
    const val CHOICES = "Podés elegir"
    const val FIELD_NOTE = "Lo escribís vos. Yo no lo veo ni lo guardo."
    const val CLICK_OFFER = "Si querés, lo toco yo."
    const val COMPLETED = "Listo."
    const val DID_YOU_FINISH = "¿Pudiste terminar? No vi una confirmación en la página."
    const val UNSURE = "No sé bien"
    const val OPTIONS_TITLE = "¿Qué querés hacer acá?"
    const val OPTIONS_LEAD = "Encontré estas opciones en esta página"
    const val LISTENING = "Te escucho. Decí cuál querés."
    const val RETRY = "No te entendí. ¿Cuál querés?"
    fun chosen(label: String) = "Elegiste «$label»."

    /** Máximo que acepta /v1/speak (SPEAK_MAX_CHARS). */
    const val MAX_CHARS = 600
}

/** Una línea, sin espacios de más ni caracteres de control. */
fun normalizeSpeech(text: String): String = text.replace(Regex("[\\p{Cc}\\p{Cf}]"), " ").replace(Regex("\\s+"), " ").trim()

/** Recorta sin cortar palabras (si una sola palabra no entra, se corta). */
fun clipForSpeech(text: String, max: Int = VoiceTexts.MAX_CHARS): String {
    val clean = normalizeSpeech(text)
    if (clean.length <= max) return clean
    val cut = clean.substring(0, max + 1)
    val lastSpace = cut.lastIndexOf(' ')
    return (if (lastSpace > 0) cut.substring(0, lastSpace) else clean.substring(0, max)).trim()
}

/** Une frases de Guíame con punto final y descarta las vacías. */
fun joinSpeech(vararg parts: String?): String = clipForSpeech(
    parts.filterNotNull().map(::normalizeSpeech).filter { it.isNotEmpty() }
        .joinToString(" ") { if (Regex("[.!?…:]$").containsMatchIn(it)) it else "$it." },
)

/** «a, b o c». */
fun listSpeech(items: List<String>): String =
    if (items.size > 1) "${items.dropLast(1).joinToString(", ")} o ${items.last()}" else items.firstOrNull() ?: ""

/** Pregunta del inicio con sus respuestas y «No sé bien». */
fun questionSpeech(question: String, answers: List<String>): String =
    joinSpeech(question, "${VoiceTexts.CHOICES}: ${listSpeech(answers + VoiceTexts.UNSURE)}")

/** Sitios sugeridos en el inicio. TODO(copy): escritorio no lee esta lista. */
fun sitesSpeech(titles: List<String>): String =
    if (titles.isEmpty()) "" else joinSpeech("${VoiceTexts.CHOICES}: ${listSpeech(titles)}")

/** Opciones de la página (05). */
fun optionsSpeech(titles: List<String>): String =
    if (titles.isEmpty()) "" else joinSpeech(VoiceTexts.OPTIONS_TITLE, "${VoiceTexts.OPTIONS_LEAD}: ${listSpeech(titles)}")

/** La instrucción del paso, el aviso de dato sensible y, si se puede, la oferta de tocarlo. */
fun stepSpeech(instruction: String, sensitive: Boolean, offerClick: Boolean): String =
    joinSpeech(instruction, VoiceTexts.FIELD_NOTE.takeIf { sensitive }, VoiceTexts.CLICK_OFFER.takeIf { offerClick })

/** «Tocá «Continuar» por mí» con el nombre del control de la instrucción, o «Tocalo por mí». */
fun clickForMeLabel(instruction: String): String =
    Regex("«[^»]+»").find(instruction)?.value?.let { "Tocá $it por mí" } ?: "Tocalo por mí"

/**
 * Las respuestas de una pregunta del inicio sin las de duda («Todavía no sé»,
 * «No estoy seguro»): la app ya agrega «No sé bien» y no tiene que aparecer
 * dos veces. Solo la respuesta entera: «No sé cuál me corresponde» se queda.
 */
fun withoutUnsure(answers: List<String>): List<String> =
    answers.filterNot { UNSURE_ANSWER.matches(normalizeSpoken(it)) }

private val UNSURE_ANSWER = Regex("^(todavia |aun |la verdad )?(no (lo )?se|no estoy segur[oa]|ni idea|no sabria)( bien| todavia| aun)?$")

/* --------------------------- Barrera de acciones --------------------------- */

/** Minúsculas, sin tildes ni signos, espacios simples (y «camelCase» separado). */
fun plainWords(text: String): String =
    Normalizer.normalize(text.replace(Regex("([a-z])([A-Z])"), "$1 $2"), Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "")
        .lowercase()
        .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
        .trim()

private val IRREVERSIBLE_ACTION = Regex(
    "\\b(pag(?:ar|a|as|o|os|ue|ues|uen|alo)?|abon\\w*|compr\\w*|transfer\\w*|firm\\w*|dar de baja|darme de baja|baja de|" +
        "elimin\\w*|borr\\w*|cancel\\w*|anul\\w*|suscrib\\w*|don(?:ar|a|acion)|checkout|pay|buy|purchase|delete|remove|unsubscribe|sign up)\\b",
)

/**
 * Barrera local para tocar un botón por la persona: aunque la IA lo haya
 * marcado como seguro (`safeToClick`), nunca se toca uno cuya instrucción o
 * rótulo hable de pagar, comprar, transferir, firmar, dar de baja o borrar.
 */
fun isIrreversibleAction(vararg texts: String?): Boolean =
    texts.any { it != null && IRREVERSIBLE_ACTION.containsMatchIn(plainWords(it)) }

/* ------------------------- Respuesta por voz ------------------------- */

/** Una opción que se puede elegir hablando: lo mismo que su botón. */
data class Choice(
    val label: String,
    val aliases: List<String> = emptyList(),
    /** `Unsure`: «No sé bien»; `Yes`: la respuesta afirmativa («Tocá … por mí»). */
    val kind: Kind? = null,
) {
    enum class Kind { Unsure, Yes }
}

sealed interface ChoiceMatch {
    data class Match(val index: Int) : ChoiceMatch
    data object Tie : ChoiceMatch
    data object None : ChoiceMatch
}

/** Minúsculas, sin tildes ni signos, espacios simples. */
fun normalizeSpoken(text: String): String =
    Normalizer.normalize(text, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()
        .replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()

private val STOPWORDS =
    "a al con de del el en es esa ese eso esta este la las lo los me mi o opcion para por porfa favor que quiero se si un una uno unos y ya dale bueno elijo voy ir"
        .split(' ').toSet()

private fun words(text: String) = normalizeSpoken(text).split(' ').filter { it.length > 1 && it !in STOPWORDS }

private val ORDINALS = listOf(
    Regex("\\b(primera|primero|1)\\b") to 0,
    Regex("\\b(segunda|segundo|2)\\b") to 1,
    Regex("\\b(tercera|tercero|3)\\b") to 2,
    Regex("\\b(cuarta|cuarto|4)\\b") to 3,
    Regex("\\b(quinta|quinto|5)\\b") to 4,
)

/** Números en palabras: solo cuentan como ordinal en frases cortas («la dos»). */
private val SPOKEN_NUMBERS = listOf(
    Regex("\\b(uno|una)\\b") to 0,
    Regex("\\b(dos)\\b") to 1,
    Regex("\\b(tres)\\b") to 2,
    Regex("\\b(cuatro)\\b") to 3,
    Regex("\\b(cinco)\\b") to 4,
)

private val UNSURE = Regex("\\b(no se|no estoy segur[oa]|ni idea|no sabria)\\b")
private val UNSURE_FILLER = setOf("no", "se", "bien", "estoy", "seguro", "segura", "ni", "idea", "sabria", "cual", "que", "decirte", "eh", "mmm")
private val YES = Regex("^(si|claro|dale|correcto|esta bien|ok|okey|bien|listo|tocalo|hacelo)\\b")

private fun ordinalIndex(said: String, count: Int): Int? {
    // «primera vez» habla de un trámite, no de la opción número uno.
    val spoken = said.replace(Regex("\\b(primera|primer|segunda|tercera) vez\\b"), " ").replace(Regex("\\s+"), " ").trim()
    if (count == 0) return null
    if (Regex("\\b(ultima|ultimo)\\b").containsMatchIn(spoken)) return count - 1
    val table = if (spoken.split(' ').size <= 3) ORDINALS + SPOKEN_NUMBERS else ORDINALS
    val found = table.filter { (pattern, _) -> pattern.containsMatchIn(spoken) }.map { it.second }.toSet()
    if (found.size != 1) return null
    return found.first().takeIf { it < count }
}

/**
 * Compara lo que dijo la persona con las opciones, en el cliente y sin IA:
 * 1. el título completo dentro de lo dicho (el más largo gana);
 * 2. números y ordinales («la primera», «la dos», «la última»);
 * 3. «sí»/«dale» → la opción `Yes`; «no sé» solo, → la opción `Unsure`;
 * 4. palabras en común con el título; gana la de mayor proporción si es clara.
 */
fun matchChoice(said: String, choices: List<Choice>): ChoiceMatch {
    val spoken = normalizeSpoken(said)
    if (spoken.isEmpty() || choices.isEmpty()) return ChoiceMatch.None

    val full = choices.withIndex()
        .flatMap { (index, c) ->
            (listOf(c.label) + c.aliases).map(::normalizeSpoken).filter { it.length > 2 && " $spoken ".contains(" $it ") }
                .map { index to it.length }
        }
        .sortedByDescending { it.second }
    if (full.isNotEmpty() && (full.size == 1 || full[0].second > full[1].second || full[0].first == full[1].first)) {
        return ChoiceMatch.Match(full[0].first)
    }

    ordinalIndex(spoken, choices.size)?.let { return ChoiceMatch.Match(it) }

    val yes = choices.indexOfFirst { it.kind == Choice.Kind.Yes }
    if (yes >= 0 && YES.containsMatchIn(spoken)) return ChoiceMatch.Match(yes)
    val unsure = choices.indexOfFirst { it.kind == Choice.Kind.Unsure }
    val onlyUnsure = UNSURE.containsMatchIn(spoken) && spoken.split(' ').all { it in UNSURE_FILLER || it in STOPWORDS }
    if (unsure >= 0 && onlyUnsure) return ChoiceMatch.Match(unsure)

    val saidWords = words(spoken).toSet()
    if (saidWords.isEmpty()) return ChoiceMatch.None
    val scores = choices.map { c ->
        if (c.kind != null) 0.0
        else (listOf(c.label) + c.aliases).maxOf { name ->
            val titleWords = words(name)
            if (titleWords.isEmpty()) 0.0 else titleWords.count { it in saidWords }.toDouble() / titleWords.size
        }
    }
    val best = scores.max()
    if (best < 0.5) return ChoiceMatch.None
    val winners = scores.withIndex().filter { it.value == best }.map { it.index }
    return if (winners.size == 1) ChoiceMatch.Match(winners[0]) else ChoiceMatch.Tie
}
