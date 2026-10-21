package uy.guiame.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Cliente de la API v1 (ver docs/api.md). Solo los endpoints que usa el
 * spike: interpret, options, next-step y transcribe. Los pasos se guardan como JSON tal
 * cual vinieron, porque vuelven al backend en `completedSteps`.
 */
class GuiameApi(
    private val baseUrl: String = BuildConfig.API_URL,
    private val token: String = BuildConfig.API_TOKEN,
) {
    // /v1/next-step puede investigar en la web: entre 10 y 20 s más.
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .build()
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun interpret(sessionId: String?, messages: List<ChatMessage>): InterpretResult {
        val body = buildJsonObject {
            sessionId?.let { put("sessionId", it) }
            put("messages", JsonArray(messages.map { buildJsonObject { put("role", it.role); put("content", it.content) } }))
        }
        val res = post("/v1/interpret", body)
        val session = res.string("sessionId")
        val message = res.string("message") ?: ""
        return when (res.string("type")) {
            "redirect" -> InterpretResult.Redirect(session, message, res.string("url") ?: error("redirect sin url"))
            "options" -> InterpretResult.Sites(
                session,
                message,
                res["options"]!!.jsonArray.map { o ->
                    val obj = o.jsonObject
                    SiteChoice(obj.string("title") ?: "", obj.string("url") ?: "", obj.string("reason"))
                },
            )
            else -> InterpretResult.Question(
                session,
                message,
                res["answers"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList(),
            )
        }
    }

    suspend fun options(sessionId: String?, page: PageRead): OptionsResult {
        val body = buildJsonObject {
            sessionId?.let { put("sessionId", it) }
            put("html", page.html)
            put("metadata", page.metadata())
        }
        val res = post("/v1/options", body)
        return OptionsResult(
            res.string("sessionId"),
            res["options"]!!.jsonArray.map { o ->
                val obj = o.jsonObject
                PageOption(obj.string("id")!!, obj.string("title")!!, obj["steps"]!!.jsonArray.map { GuideStep(it.jsonObject) })
            },
        )
    }

    suspend fun nextStep(
        sessionId: String,
        optionId: String,
        expected: GuideStep,
        completed: List<GuideStep>,
        page: PageRead,
    ): NextStepResult {
        val body = buildJsonObject {
            put("sessionId", sessionId)
            put("optionId", optionId)
            put("expectedStep", expected.raw)
            put("completedSteps", JsonArray(completed.map { it.raw }))
            put("html", page.html)
            put("metadata", page.metadata())
        }
        val res = post("/v1/next-step", body)
        return NextStepResult(
            res.string("sessionId") ?: sessionId,
            res["steps"]?.jsonArray?.map { GuideStep(it.jsonObject) } ?: emptyList(),
            res["done"]?.jsonPrimitive?.booleanOrNull == true,
            res.string("evidence"),
        )
    }

    /**
     * Voz a texto: WAV PCM 16 bits mono 16 kHz, entre 0,3 y 30 s. Devuelve ""
     * si no se entendió nada. Ni el audio ni el texto se guardan ni se loguean.
     */
    suspend fun transcribe(wav: ByteArray): String =
        send("/v1/transcribe", wav.toRequestBody("audio/wav".toMediaType())).string("text") ?: ""

    private suspend fun post(path: String, body: JsonObject): JsonObject =
        send(path, body.toString().toRequestBody("application/json".toMediaType()))

    private suspend fun send(path: String, body: RequestBody): JsonObject = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("Authorization", "Bearer $token")
            .post(body)
            .build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string() ?: ""
            // Nunca se loguea el cuerpo: puede traer lo que pidió la persona.
            if (!response.isSuccessful) {
                val error = runCatching { json.parseToJsonElement(text).jsonObject["error"]?.jsonObject }.getOrNull()
                throw ApiException(
                    response.code,
                    error?.string("code"),
                    error?.get("retryable")?.jsonPrimitive?.booleanOrNull == true,
                )
            }
            json.parseToJsonElement(text).jsonObject
        }
    }
}

/** Error de la API: estado HTTP y el `code`/`retryable` del contrato (ApiError), sin el mensaje. */
class ApiException(val status: Int, val code: String? = null, val retryable: Boolean = false) :
    Exception("API respondió $status")

data class ChatMessage(val role: String, val content: String)

data class SiteChoice(val title: String, val url: String, val reason: String?)

sealed interface InterpretResult {
    val sessionId: String?
    data class Redirect(override val sessionId: String?, val message: String, val url: String) : InterpretResult
    data class Sites(override val sessionId: String?, val message: String, val sites: List<SiteChoice>) : InterpretResult
    data class Question(override val sessionId: String?, val message: String, val answers: List<String>) : InterpretResult
}

/** Lo que el agente de página extrajo: HTML sintético sin valores y el metadato depurado. */
data class PageRead(val html: String, val title: String?, val language: String?, val origin: String?) {
    fun metadata(): JsonObject = buildJsonObject {
        put(
            "page",
            buildJsonObject {
                title?.let { put("title", it) }
                language?.let { put("language", it) }
                origin?.let { put("origin", it) }
            },
        )
    }
}

data class PageOption(val id: String, val title: String, val steps: List<GuideStep>)

data class OptionsResult(val sessionId: String?, val options: List<PageOption>)

data class NextStepResult(val sessionId: String, val steps: List<GuideStep>, val done: Boolean, val evidence: String?)

/** Un paso de la guía (GuideStep del contrato), con el JSON original. */
class GuideStep(val raw: JsonObject) {
    val element: String? get() = raw.string("element")
    val instruction: String get() = raw.string("instruction") ?: ""
    val waitFor: String get() = raw.string("waitFor") ?: "userInteraction"
    val field: JsonObject? get() = raw["field"] as? JsonObject
    val fieldSensitive: Boolean get() = this.field?.get("sensitive")?.jsonPrimitive?.booleanOrNull == true
    val fieldQuestion: String? get() = this.field?.string("question")
}

internal fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull
