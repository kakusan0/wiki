# Android アプリ（Android Studio プロジェクト）

いまのサイトを、Chrome の機能を使って全画面で開くお客様用 Android アプリです（Trusted Web Activity）。
画面や処理はすべてサイト側にあるので、サイトを更新すればアプリの中身も更新されます。カメラや Google Pay もブラウザと同じように動きます。
（※店舗管理用の Android アプリは別リポジトリ `kakusan0/qr-order` に分離しました。）

| 種類（ビルドバリアント） | アプリ名 | 最初に開く画面 | パッケージ名 |
| --- | --- | --- | --- |
| `customer` | QR オーダー | `/s/<店舗ID>` | `dev.workers.gmakihiro.qrorder.customer` |

## Android Studio で開く

1. Android Studio の「Open」で、この `android` フォルダを選ぶ（リポジトリの一番上ではなく `android`）。
2. 初回は必要な部品のダウンロードと同期に数分かかる。
3. 左下の「Build Variants」で `customerDebug` を選ぶ。
4. 実機を USB でつなぐかエミュレーターを起動して、▶（Run）を押す。

端末に Chrome が入っている必要があります。

## アドレスバーを消す（サイトとの紐づけ）

そのままだと、アプリの上部にアドレスバーが出ます。アプリの署名鍵とサイトを紐づけると、アドレスバーのない全画面になります。

1. 署名鍵の SHA-256 フィンガープリントを調べる。
   - 開発用：Android Studio の右側「Gradle」→ `app` → `Tasks` → `android` → `signingReport` を実行し、`SHA-256` の行を見る。
   - 公開用：Google Play Console の「アプリの署名」に表示される「アプリ署名鍵の証明書」の SHA-256。
2. Cloudflare の `qr-order` → 設定 → 変数とシークレットに `ANDROID_CERT_SHA256` を追加し、フィンガープリント（`AB:CD:…` の形式）を入れる。開発用と公開用など複数ある場合はカンマで区切る。
3. `https://<サイト>/.well-known/assetlinks.json` を開き、パッケージ名とフィンガープリントが出ていることを確かめる。
4. アプリを入れ直して起動する（確認には数十秒かかることがある）。

フィンガープリントは公開してよい値です（秘密にするのは署名鍵そのもの）。

## 設定を変える場所

- 開くサイト、お客様用アプリの店舗：`gradle.properties` の `twa.host`、`twa.customerStoreId`
- アプリ名・色：`app/src/staff/res/values/`、`app/src/customer/res/values/`
- パッケージ名・バージョン：`app/build.gradle.kts`（パッケージ名は Google Play に出したあとは変えられない）

パッケージ名を変えた場合は、Cloudflare の `ANDROID_PACKAGES` に新しい名前（カンマ区切り）を設定してください。

## 公開用のビルド

1. Android Studio の「Build」→「Generate Signed App Bundle / APK」で署名鍵（.jks）を作る。**署名鍵とパスワードは必ず自分で保管し、リポジトリには入れない**（なくすとアプリを更新できなくなる）。
2. コマンドでビルドする場合は、`android/keystore.properties` を作る（このファイルは Git の管理対象外）。

   ```properties
   storeFile=../my-release-key.jks
   storePassword=...
   keyAlias=...
   keyPassword=...
   ```

3. `./gradlew bundleStaffRelease`（または `bundleCustomerRelease`）で、Google Play に出す .aab ができる。

## 自動ビルド

`android/` を変更して `main` にプッシュすると、GitHub Actions（`.github/workflows/android.yml`）が動作確認用の APK をビルドし、実行結果の「Artifacts」に `debug-apks` として残します。
