export const MOBILEFLOW_WORKFLOW_PATH = '.github/workflows/mobileflow.yml';
export const MOBILEFLOW_WORKFLOW_FILENAME = 'mobileflow.yml';

// Squelette Capacitor : compilation Android réelle (gradlew assembleDebug), iOS reste un
// placeholder (pas de signature — cf. Secret Vault Phase 4, l'injection des secrets dans
// le workflow est une itération ultérieure).
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
      - name: Build debug APK
        run: cd android && ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
        with:
          name: mobileflow-\${{ inputs.build_id }}-android
          path: android/app/build/outputs/apk/debug/*.apk

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
      - name: Placeholder iOS
        run: echo "Squelette iOS — compilation/signature Xcode réelle prévue lors d'une itération ultérieure."
`;
}
