export const MOBILEFLOW_WORKFLOW_PATH = '.github/workflows/mobileflow.yml';
export const MOBILEFLOW_WORKFLOW_FILENAME = 'mobileflow.yml';

// Android : staging = compilation réelle non signée (gradlew assembleDebug) ; production =
// compilation + signature réelles (gradlew assembleRelease, puis zipalign/apksigner).
// iOS : compilation + signature réelles, toujours — staging exporte Ad Hoc, production exporte
// App Store (même certificat de distribution, provisioning profile et méthode d'export
// différents — cf. IOS_SIGNING_ENVIRONMENTS_PLAN.md).
// Dans tous les cas où une signature est requise, le certificat/keystore ne sont jamais
// committés dans le repo : ils sont récupérés à l'exécution via un token de run à courte durée
// de vie (cf. apps/api/src/internal/) appelant l'endpoint interne GET /internal/secrets.
export function buildWorkflowYaml(): string {
  return `name: MobileFlow Build
run-name: "MobileFlow build \${{ inputs.build_id }} (\${{ inputs.platform }})"

on:
  workflow_dispatch:
    inputs:
      build_id:
        description: 'Identifiant du build MobileFlow'
        required: true
      environment:
        description: 'Environnement (staging/production)'
        required: true
      platform:
        description: 'Plateforme (android/ios)'
        required: true
      secrets_token:
        description: 'Token de run à courte durée de vie pour récupérer les secrets de signature (iOS, ou Android en production)'
        required: false
      api_url:
        description: "URL publique de l'API MobileFlow (requis si secrets_token est fourni)"
        required: false

jobs:
  build-android:
    if: \${{ inputs.platform == 'android' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - run: npx cap sync android
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
      - uses: android-actions/setup-android@v3
      - name: Build debug APK (staging)
        if: \${{ inputs.environment != 'production' }}
        run: cd android && ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
        if: \${{ inputs.environment != 'production' }}
        with:
          name: mobileflow-\${{ inputs.build_id }}-android
          path: android/app/build/outputs/apk/debug/*.apk
      - name: Fetch signing secrets
        if: \${{ inputs.environment == 'production' }}
        env:
          SECRETS_TOKEN: \${{ inputs.secrets_token }}
          API_URL: \${{ inputs.api_url }}
        run: |
          RESPONSE=$(curl -sf -H "Authorization: Bearer $SECRETS_TOKEN" "$API_URL/internal/secrets")
          if [ "$(echo "$RESPONSE" | jq -r '.androidKeystore')" = "null" ]; then
            echo "::error::Aucun keystore Android configuré dans le Secret Vault pour ce projet."
            exit 1
          fi
          echo "$RESPONSE" | jq -r '.androidKeystore.fileBase64' | base64 --decode > "$RUNNER_TEMP/release.keystore"
          STORE_PASSWORD=$(echo "$RESPONSE" | jq -r '.androidKeystore.password')
          KEY_ALIAS=$(echo "$RESPONSE" | jq -r '.androidKeystore.alias')
          KEY_PASSWORD=$(echo "$RESPONSE" | jq -r '.androidKeystore.keyPassword')
          if [ "$KEY_PASSWORD" = "null" ] || [ -z "$KEY_PASSWORD" ]; then
            KEY_PASSWORD="$STORE_PASSWORD"
          fi
          echo "::add-mask::$STORE_PASSWORD"
          echo "::add-mask::$KEY_PASSWORD"
          echo "STORE_PASSWORD=$STORE_PASSWORD" >> "$GITHUB_ENV"
          echo "KEY_ALIAS=$KEY_ALIAS" >> "$GITHUB_ENV"
          echo "KEY_PASSWORD=$KEY_PASSWORD" >> "$GITHUB_ENV"
      - name: Build signed release APK (production)
        if: \${{ inputs.environment == 'production' }}
        run: |
          cd android && ./gradlew assembleRelease
          SDK_DIR="\${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
          BUILD_TOOLS_DIR=$(dirname "$(ls -d "$SDK_DIR"/build-tools/*/ | sort -V | tail -1)")
          "$BUILD_TOOLS_DIR"/zipalign -v -p 4 \\
            app/build/outputs/apk/release/app-release-unsigned.apk \\
            "$RUNNER_TEMP/app-release-aligned.apk"
          "$BUILD_TOOLS_DIR"/apksigner sign \\
            --ks "$RUNNER_TEMP/release.keystore" \\
            --ks-pass "pass:$STORE_PASSWORD" \\
            --ks-key-alias "$KEY_ALIAS" \\
            --key-pass "pass:$KEY_PASSWORD" \\
            --out "$RUNNER_TEMP/app-release-signed.apk" \\
            "$RUNNER_TEMP/app-release-aligned.apk"
      - uses: actions/upload-artifact@v4
        if: \${{ inputs.environment == 'production' }}
        with:
          name: mobileflow-\${{ inputs.build_id }}-android
          path: \${{ runner.temp }}/app-release-signed.apk
      - name: Clean up keystore
        if: \${{ always() && inputs.environment == 'production' }}
        run: rm -f "$RUNNER_TEMP/release.keystore"

  build-ios:
    if: \${{ inputs.platform == 'ios' }}
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - run: npx cap sync ios
      - name: Fetch signing secrets
        env:
          SECRETS_TOKEN: \${{ inputs.secrets_token }}
          API_URL: \${{ inputs.api_url }}
        run: |
          RESPONSE=$(curl -sf -H "Authorization: Bearer $SECRETS_TOKEN" "$API_URL/internal/secrets")
          if [ "$(echo "$RESPONSE" | jq -r '.iosCertificate')" = "null" ]; then
            echo "::error::Aucun certificat iOS configuré dans le Secret Vault pour ce projet."
            exit 1
          fi
          if [ "$(echo "$RESPONSE" | jq -r '.iosProvisioningProfile')" = "null" ]; then
            echo "::error::Aucun provisioning profile iOS configuré dans le Secret Vault pour ce projet."
            exit 1
          fi
          echo "$RESPONSE" | jq -r '.iosCertificate.fileBase64' | base64 --decode > "$RUNNER_TEMP/certificate.p12"
          echo "$RESPONSE" | jq -r '.iosProvisioningProfile.fileBase64' | base64 --decode > "$RUNNER_TEMP/profile.mobileprovision"
          CERT_PASSWORD=$(echo "$RESPONSE" | jq -r '.iosCertificate.password')
          echo "::add-mask::$CERT_PASSWORD"
          echo "CERT_PASSWORD=$CERT_PASSWORD" >> "$GITHUB_ENV"
      - name: Import signing certificate into a temporary keychain
        run: |
          KEYCHAIN_PASSWORD=$(openssl rand -base64 24)
          echo "::add-mask::$KEYCHAIN_PASSWORD"
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security set-keychain-settings -t 3600 -u build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security list-keychains -d user -s build.keychain $(security list-keychains -d user | sed 's/"//g')
          security default-keychain -s build.keychain
          security import "$RUNNER_TEMP/certificate.p12" -k build.keychain -P "$CERT_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain
      - name: Install provisioning profile
        run: |
          mkdir -p ~/Library/MobileDevice/Provisioning\\ Profiles
          cp "$RUNNER_TEMP/profile.mobileprovision" ~/Library/MobileDevice/Provisioning\\ Profiles/mobileflow.mobileprovision
          security cms -D -i "$RUNNER_TEMP/profile.mobileprovision" > "$RUNNER_TEMP/profile.plist"
          TEAM_ID=$(/usr/libexec/PlistBuddy -c "Print :TeamIdentifier:0" "$RUNNER_TEMP/profile.plist")
          PROFILE_NAME=$(/usr/libexec/PlistBuddy -c "Print :Name" "$RUNNER_TEMP/profile.plist")
          APP_ID=$(/usr/libexec/PlistBuddy -c "Print :Entitlements:application-identifier" "$RUNNER_TEMP/profile.plist")
          BUNDLE_ID=\${APP_ID#$TEAM_ID.}
          echo "TEAM_ID=$TEAM_ID" >> "$GITHUB_ENV"
          echo "PROFILE_NAME=$PROFILE_NAME" >> "$GITHUB_ENV"
          echo "BUNDLE_ID=$BUNDLE_ID" >> "$GITHUB_ENV"
      - name: Build signed archive
        run: |
          xcodebuild -workspace ios/App/App.xcworkspace \\
            -scheme App \\
            -configuration Release \\
            -destination "generic/platform=iOS" \\
            -archivePath "$RUNNER_TEMP/App.xcarchive" \\
            CODE_SIGN_STYLE=Manual \\
            CODE_SIGN_IDENTITY="iPhone Distribution" \\
            DEVELOPMENT_TEAM="$TEAM_ID" \\
            PROVISIONING_PROFILE_SPECIFIER="$PROFILE_NAME" \\
            IPHONEOS_DEPLOYMENT_TARGET=16.0 \\
            archive
      - name: Export IPA
        run: |
          EXPORT_METHOD="ad-hoc"
          if [ "\${{ inputs.environment }}" = "production" ]; then
            EXPORT_METHOD="app-store"
          fi
          printf '<?xml version="1.0" encoding="UTF-8"?>\\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\\n<plist version="1.0">\\n<dict>\\n  <key>method</key>\\n  <string>%s</string>\\n  <key>teamID</key>\\n  <string>%s</string>\\n  <key>signingStyle</key>\\n  <string>manual</string>\\n  <key>provisioningProfiles</key>\\n  <dict>\\n    <key>%s</key>\\n    <string>%s</string>\\n  </dict>\\n</dict>\\n</plist>\\n' "$EXPORT_METHOD" "$TEAM_ID" "$BUNDLE_ID" "$PROFILE_NAME" > "$RUNNER_TEMP/exportOptions.plist"
          xcodebuild -exportArchive \\
            -archivePath "$RUNNER_TEMP/App.xcarchive" \\
            -exportOptionsPlist "$RUNNER_TEMP/exportOptions.plist" \\
            -exportPath "$RUNNER_TEMP/export"
      - uses: actions/upload-artifact@v4
        with:
          name: mobileflow-\${{ inputs.build_id }}-ios
          path: \${{ runner.temp }}/export/*.ipa
      - name: Clean up temporary keychain
        if: always()
        run: security delete-keychain build.keychain || true
`;
}
