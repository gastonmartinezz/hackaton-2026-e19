package uy.guiame.android

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Lee en voz alta los textos de Guíame. Primero con la voz del servidor
 * (/v1/speak, MP3); si no está disponible, con la voz del teléfono en
 * español. Una sola lectura a la vez: una nueva corta la anterior.
 *
 * Privacidad: solo recibe texto escrito por Guíame. El MP3 se guarda un
 * momento en la caché de la app para reproducirlo y se borra al terminar.
 */
class Speaker(context: Context, private val api: GuiameApi) {
    private val app = context.applicationContext
    private var player: MediaPlayer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady: Boolean? = null

    /** Lee el texto y vuelve cuando terminó. Si se cancela la corrutina, se calla. */
    suspend fun say(text: String) {
        val clean = clipForSpeech(text)
        if (clean.isEmpty()) return
        stop()
        val audio = runCatching { api.speak(clean) }.getOrNull()
        if (audio == null || !playMp3(audio, minMs = clean.length * MIN_MS_PER_CHAR)) systemSay(clean)
    }

    fun stop() {
        player?.runCatching { stop() }
        player?.release()
        player = null
        tts?.stop()
    }

    fun shutdown() {
        stop()
        tts?.shutdown()
        tts = null
    }

    /**
     * Reproduce el MP3 y vuelve al terminar. Devuelve false sin sonar si no es
     * una lectura real: el modo de prueba del servidor manda un MP3 corto de
     * silencio, que dura mucho menos de lo que tarda en leerse el texto.
     */
    private suspend fun playMp3(audio: ByteArray, minMs: Int): Boolean {
        val file = withContext(Dispatchers.IO) {
            File.createTempFile("guiame-voz", ".mp3", app.cacheDir).apply { writeBytes(audio) }
        }
        try {
            return suspendCancellableCoroutine { cont ->
                val mp = MediaPlayer()
                player = mp
                mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                mp.setOnCompletionListener { cont.resumeOnce(true) }
                mp.setOnErrorListener { _, _, _ -> cont.resumeOnce(false); true }
                runCatching {
                    mp.setDataSource(file.absolutePath)
                    mp.prepare()
                    if (mp.duration in 0 until minMs) cont.resumeOnce(false) else mp.start()
                }.onFailure { cont.resumeOnce(false) }
                cont.invokeOnCancellation { stop() }
            }
        } finally {
            if (player != null) stop()
            withContext(Dispatchers.IO) { file.delete() }
        }
    }

    private suspend fun systemSay(text: String) {
        val engine = engine() ?: return
        suspendCancellableCoroutine { cont ->
            val id = "guiame-${System.nanoTime()}"
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit
                override fun onDone(utteranceId: String?) { if (utteranceId == id) cont.resumeOnce() }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { if (utteranceId == id) cont.resumeOnce() }
            })
            if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) cont.resumeOnce()
            cont.invokeOnCancellation { engine.stop() }
        }
    }

    /** El motor de voz del teléfono en español (es-AR, si no es-UY, si no cualquier español), o null si no hay. */
    private suspend fun engine(): TextToSpeech? {
        tts?.let { return if (ttsReady == true) it else null }
        val ready = suspendCancellableCoroutine { cont ->
            tts = TextToSpeech(app) { status -> cont.resumeOnce(status == TextToSpeech.SUCCESS) }
        }
        val engine = tts ?: return null
        val spanish = listOf(Locale("es", "AR"), Locale("es", "UY"), Locale("es"))
            .firstOrNull { engine.isLanguageAvailable(it) >= TextToSpeech.LANG_AVAILABLE }
        ttsReady = ready && spanish != null
        if (ttsReady == true) engine.language = spanish
        return engine.takeIf { ttsReady == true }
    }

    private companion object {
        /** Leer en voz alta lleva unos 60 ms por carácter; menos de 20 no es una lectura real. */
        const val MIN_MS_PER_CHAR = 20
    }
}

private fun CancellableContinuation<Unit>.resumeOnce() {
    if (isActive) resume(Unit)
}

@JvmName("resumeOnceBoolean")
private fun CancellableContinuation<Boolean>.resumeOnce(value: Boolean) {
    if (isActive) resume(value)
}
