import java.util.Properties

plugins {
    id("com.android.application")
}

val twaHost: String = providers.gradleProperty("twa.host").get()
val customerStoreId: String = providers.gradleProperty("twa.customerStoreId").get()

// リリース用の署名鍵（android/keystore.properties に書く。ファイルがなければ署名なしでビルドする）
val keystoreFile = rootProject.file("keystore.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use { load(it) } }

android {
    namespace = "dev.workers.gmakihiro.qrorder"
    compileSdk = 36

    defaultConfig {
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        // このアプリとサイトが同じ持ち主であることの宣言（サイト側の /.well-known/assetlinks.json と対になる）
        resValue(
            "string",
            "asset_statements",
            """[{\"relation\": [\"delegate_permission/common.handle_all_urls\"], \"target\": {\"namespace\": \"web\", \"site\": \"https://$twaHost\"}}]""",
        )
        manifestPlaceholders["hostName"] = twaHost
    }

    // 2 種類のアプリを同じプロジェクトから作る
    flavorDimensions += "audience"
    productFlavors {
        create("staff") {
            dimension = "audience"
            applicationId = "dev.workers.gmakihiro.qrorder.staff"
            manifestPlaceholders["defaultUrl"] = "https://$twaHost/staff"
            manifestPlaceholders["pathPrefix"] = "/staff"
        }
        create("customer") {
            dimension = "audience"
            applicationId = "dev.workers.gmakihiro.qrorder.customer"
            manifestPlaceholders["defaultUrl"] = "https://$twaHost/s/$customerStoreId"
            manifestPlaceholders["pathPrefix"] = "/s/"
        }
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystoreFile.exists()) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // サイトを Chrome の機能で全画面表示する（Trusted Web Activity）
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
