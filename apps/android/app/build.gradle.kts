import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// La API y el token salen de local.properties (no se sube a git). Por defecto,
// la API local vista desde el emulador: 10.0.2.2 es la Mac donde corre el emulador.
val local = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val apiUrl = local.getProperty("guiame.apiUrl") ?: "http://10.0.2.2:3000"
val apiToken = local.getProperty("guiame.apiToken") ?: "dev-token-solo-para-desarrollo-local"

android {
    namespace = "uy.guiame.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "uy.guiame.android"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0-spike"
        buildConfigField("String", "API_URL", "\"$apiUrl\"")
        buildConfigField("String", "API_TOKEN", "\"$apiToken\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// El agente de página se compila desde TypeScript (apps/android/web). Sin él la
// app no puede leer ni resaltar nada, así que el build falla con instrucciones.
val checkPageAgent by tasks.registering {
    val agent = file("src/main/assets/page-agent.js")
    doLast {
        if (!agent.exists()) {
            throw GradleException(
                "Falta app/src/main/assets/page-agent.js. Desde la raíz del repo corré: " +
                    "pnpm install && pnpm --filter @asistente/android build",
            )
        }
    }
}
tasks.named("preBuild") { dependsOn(checkPageAgent) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
}
