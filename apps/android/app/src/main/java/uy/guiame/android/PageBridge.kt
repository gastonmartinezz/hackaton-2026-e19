package uy.guiame.android

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Puente con el agente de página (`assets/page-agent.js`). Es el equivalente de
 * `apps/desktop/src/main/page-bridge.ts`: manda comandos a la página y recibe
 * lo que pasa en ella, siempre sin valores de campos.
 *
 * El puente `GuiameAndroid` queda visible para la página (en Android no hay
 * mundo aislado). Por eso todo lo que llega se trata como no confiable: solo
 * canales conocidos, tamaño limitado, y ninguna acción sobre el sitio sale de
 * un mensaje de la página; las acciones salen de toques de la persona en la
 * tarjeta.
 */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
class PageBridge(
    private val webView: WebView,
    private val listener: Listener,
) {
    interface Listener {
        /** Se cargó un documento nuevo en el frame principal. */
        fun onPageReady(origin: String)
        fun onInteraction(elementId: String, event: String)
        fun onPageChanged()
    }

    private val script: String = webView.context.assets.open("page-agent.js").bufferedReader().use { it.readText() }
    private val main = Handler(Looper.getMainLooper())
    private val pending = mutableMapOf<String, CompletableDeferred<JsonObject>>()
    private var counter = 0
    private val json = Json { ignoreUnknownKeys = true }

    /** true si el WebView inyecta el agente antes que los scripts de la página. */
    val injectsAtDocumentStart: Boolean = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    fun install() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.addJavascriptInterface(JsReceiver(), "GuiameAndroid")
        if (injectsAtDocumentStart) {
            WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("*"))
        }
    }

    /** Respaldo para WebViews viejos: inyectar al terminar de cargar (el agente ignora la segunda vez). */
    fun onPageFinished() {
        if (!injectsAtDocumentStart) webView.evaluateJavascript(script, null)
    }

    suspend fun extract(navigationId: String): PageRead? {
        val requestId = nextId()
        val reply = request(requestId, "page:extract") {
            put("requestId", requestId)
            put("pageId", "p1")
            put("navigationId", navigationId)
            put("revision", counter)
        } ?: return null
        val html = reply.str("html") ?: return null
        return PageRead(html, reply.str("title"), reply.str("language"), reply.str("origin"))
    }

    suspend fun show(navigationId: String, selector: String): Shown? {
        val requestId = nextId()
        val reply = request(requestId, "page:show") {
            put("requestId", requestId)
            put("navigationId", navigationId)
            put("selector", selector)
            put("scroll", true)
        } ?: return null
        return Shown(
            result = reply.str("result") ?: "stale",
            elementId = reply.str("elementId"),
            sensitive = reply["sensitive"]?.jsonPrimitive?.booleanOrNull == true,
        )
    }

    fun focus(navigationId: String, elementId: String) {
        send("page:focus", buildJsonObject { put("navigationId", navigationId); put("elementId", elementId) })
    }

    fun clear() = send("page:clear", JsonObject(emptyMap()))

    private suspend fun request(requestId: String, channel: String, build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): JsonObject? {
        val deferred = CompletableDeferred<JsonObject>()
        pending[requestId] = deferred
        send(channel, buildJsonObject(build))
        return try {
            withTimeoutOrNull(5_000) { deferred.await() }
        } finally {
            pending.remove(requestId)
        }
    }

    private fun send(channel: String, payload: JsonObject) {
        // JsonPrimitive(...).toString() da un literal de string válido en JS.
        val js = "window.__guiameAgent && window.__guiameAgent(${JsonPrimitive(channel)}, ${JsonPrimitive(payload.toString())})"
        main.post { webView.evaluateJavascript(js, null) }
    }

    private fun nextId(): String = "r${++counter}"

    private fun receive(raw: String) {
        if (raw.length > MAX_MESSAGE) return
        val message = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return
        val channel = message.str("channel") ?: return
        val payload = message["payload"] as? JsonObject ?: return
        when (channel) {
            "page:snapshot", "page:shown" -> payload.str("requestId")?.let { pending[it]?.complete(payload) }
            "page:ready" -> listener.onPageReady(payload.str("origin") ?: "")
            "page:interaction" -> {
                val elementId = payload.str("elementId") ?: return
                val event = payload.str("event") ?: return
                listener.onInteraction(elementId, event)
            }
            "page:changed" -> listener.onPageChanged()
        }
    }

    private inner class JsReceiver {
        // Llega en un hilo del WebView: se pasa al principal.
        @JavascriptInterface
        fun postMessage(raw: String) {
            main.post { receive(raw) }
        }
    }

    data class Shown(val result: String, val elementId: String?, val sensitive: Boolean)

    private companion object {
        /** El HTML sintético tiene hasta 200.000 caracteres (límite de la API), más el sobre. */
        const val MAX_MESSAGE = 300_000
    }
}

private fun JsonObject.str(key: String): String? = string(key)
