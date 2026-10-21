package uy.guiame.android

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** Por qué terminó la grabación. */
enum class RecordingEnd { Stopped, Silence, NoSpeech, Limit }

/** Audio listo para /v1/transcribe, o null si no hay nada que mandar. */
class Recording(val wav: ByteArray?, val end: RecordingEnd)

/**
 * Graba el micrófono para el dictado del buscador: WAV PCM 16 bits mono a
 * 16 kHz, como pide /v1/transcribe. Corta sola con `SilenceDetector` (igual que
 * escritorio) o cuando la persona toca «Terminar» (`stop()`).
 *
 * Privacidad: el audio vive solo en memoria hasta que se manda; no se guarda en
 * disco ni se loguea.
 */
class VoiceRecorder {
    @Volatile private var stopRequested = false

    fun stop() {
        stopRequested = true
    }

    /**
     * Graba hasta que la persona termina o se queda en silencio. `onLevel`
     * recibe el nivel suavizado (0 a 1) cada 100 ms, para el círculo.
     * Lanza SecurityException sin permiso e IllegalStateException si el micrófono no anda.
     */
    @SuppressLint("MissingPermission") // El permiso se pide antes, en la pantalla.
    suspend fun record(onLevel: (Float) -> Unit): Recording = withContext(Dispatchers.IO) {
        stopRequested = false
        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minBuffer > 0) { "micrófono no disponible" }
        val recorder = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            max(minBuffer, FRAME_SAMPLES * 2 * 4),
        )
        check(recorder.state == AudioRecord.STATE_INITIALIZED) { "micrófono no disponible" }

        val pcm = ByteArrayOutputStream()
        val frame = ShortArray(FRAME_SAMPLES)
        val detector = SilenceDetector()
        var end = RecordingEnd.Stopped
        try {
            recorder.startRecording()
            var elapsed = 0L
            while (currentCoroutineContext().isActive && !stopRequested) {
                var read = 0
                while (read < FRAME_SAMPLES) {
                    val n = recorder.read(frame, read, FRAME_SAMPLES - read)
                    check(n >= 0) { "error del micrófono" }
                    read += n
                }
                val bytes = ByteBuffer.allocate(read * 2).order(ByteOrder.LITTLE_ENDIAN)
                var sum = 0.0
                for (i in 0 until read) {
                    bytes.putShort(frame[i])
                    val s = frame[i] / 32768.0
                    sum += s * s
                }
                pcm.write(bytes.array())
                val level = sqrt(sum / read).toFloat()
                onLevel(min(1f, level * 8f))
                elapsed += FRAME_MS
                when (detector.push(level, elapsed)) {
                    SilenceDetector.Verdict.Continue -> Unit
                    SilenceDetector.Verdict.Silence -> { end = RecordingEnd.Silence; break }
                    SilenceDetector.Verdict.NoSpeech -> { end = RecordingEnd.NoSpeech; break }
                    SilenceDetector.Verdict.Limit -> { end = RecordingEnd.Limit; break }
                }
            }
        } finally {
            runCatching { recorder.stop() }
            recorder.release()
            onLevel(0f)
        }

        val samples = pcm.size() / 2
        // Sin voz no se manda nada; menos de 0,3 s el servidor lo rechaza.
        val wav = if (end == RecordingEnd.NoSpeech || samples < MIN_SAMPLES) null else wav(pcm.toByteArray())
        Recording(wav, end)
    }

    companion object {
        const val SAMPLE_RATE = 16_000
        private const val FRAME_MS = 100L
        private const val FRAME_SAMPLES = SAMPLE_RATE / 10
        private const val MIN_SAMPLES = SAMPLE_RATE * 3 / 10

        /** Cabecera WAV canónica de 44 bytes + PCM. */
        fun wav(pcm: ByteArray): ByteArray {
            val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
                put("RIFF".toByteArray()); putInt(36 + pcm.size); put("WAVE".toByteArray())
                put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
                putInt(SAMPLE_RATE); putInt(SAMPLE_RATE * 2); putShort(2); putShort(16)
                put("data".toByteArray()); putInt(pcm.size)
            }
            return header.array() + pcm
        }
    }
}

/**
 * Cuándo dejar de escuchar: a los ~30 s, o después de 5 s seguidos sin hablar.
 * Copia de `apps/desktop/src/renderer/src/voice/silence.ts` (umbral adaptativo
 * con piso de ruido calibrado y pico de voz); ver ahí la explicación.
 */
class SilenceDetector {
    enum class Verdict { Continue, Silence, NoSpeech, Limit }

    private var lastVoice: Long? = null
    private val recent = ArrayDeque<Float>()
    private var floor: Float? = null
    private var peak = 0f

    /** Una medición de energía (RMS de 100 ms) a los `elapsed` ms de empezar. */
    fun push(level: Float, elapsed: Long): Verdict {
        if (elapsed >= MAX_MS) return Verdict.Limit

        recent.addLast(level)
        if (recent.size > SMOOTH_FRAMES) recent.removeFirst()
        val smoothed = recent.sum() / recent.size

        if (elapsed < CALIBRATION_MS) {
            floor = minOf(floor ?: Float.MAX_VALUE, level, CALIBRATION_CAP)
            return Verdict.Continue
        }
        val floor = this.floor ?: min(level, CALIBRATION_CAP)
        val threshold = maxOf(MIN_THRESHOLD, floor * FLOOR_FACTOR, floor + FLOOR_MARGIN)
        peak *= PEAK_DECAY
        if (smoothed >= threshold && smoothed >= peak * PEAK_RATIO) {
            lastVoice = elapsed
            peak = max(peak, smoothed)
            return Verdict.Continue
        }
        this.floor = if (smoothed < floor) smoothed else floor + FLOOR_RISE * (smoothed - floor)
        val last = lastVoice ?: return if (elapsed >= SILENCE_MS) Verdict.NoSpeech else Verdict.Continue
        return if (elapsed - last >= SILENCE_MS) Verdict.Silence else Verdict.Continue
    }

    private companion object {
        const val MIN_THRESHOLD = 0.015f
        const val FLOOR_FACTOR = 3f
        const val FLOOR_MARGIN = 0.01f
        const val CALIBRATION_CAP = 0.03f
        const val FLOOR_RISE = 0.05f
        const val PEAK_RATIO = 0.35f
        const val PEAK_DECAY = 0.995f
        const val SMOOTH_FRAMES = 3
        const val CALIBRATION_MS = 300L
        const val SILENCE_MS = 5_000L
        // Un poco antes de 30 s: el WAV nunca supera el máximo del servidor.
        const val MAX_MS = 30_000L - 300L
    }
}
