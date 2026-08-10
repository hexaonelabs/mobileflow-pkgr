export const MOBILEFLOW_SETUP_WORKFLOW_PATH = '.github/workflows/mobileflow-setup.yml';
export const MOBILEFLOW_SETUP_WORKFLOW_FILENAME = 'mobileflow-setup.yml';

// Workflow one-shot : installe Capacitor et/ou ajoute les plateformes natives manquantes,
// puis commit le résultat directement sur la branche ciblée. Ne s'exécute que sur demande
// explicite de l'utilisateur (bouton "Configurer automatiquement").
export function buildSetupWorkflowYaml(): string {
  return `name: MobileFlow Setup
run-name: "MobileFlow setup \${{ inputs.setup_id }}"

on:
  workflow_dispatch:
    inputs:
      setup_id:
        description: 'Identifiant du run de setup MobileFlow'
        required: true
      app_id:
        description: 'Identifiant Capacitor (bundle id)'
        required: true
      app_name:
        description: "Nom de l'app Capacitor"
        required: true
      web_dir:
        description: 'Répertoire de build web (ex. www, dist, dist/app/browser)'
        required: true
      install_capacitor:
        description: 'Installer @capacitor/core + CLI + Android/iOS'
        required: true
      add_android:
        description: 'Ajouter la plateforme Android'
        required: true
      add_ios:
        description: 'Ajouter la plateforme iOS'
        required: true

permissions:
  contents: write

jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install Capacitor
        if: \${{ inputs.install_capacitor == 'true' }}
        run: npm install --save @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
      - name: Init Capacitor config
        if: \${{ inputs.install_capacitor == 'true' }}
        run: npx cap init "\${{ inputs.app_name }}" "\${{ inputs.app_id }}" --web-dir="\${{ inputs.web_dir }}" || true
      - name: Add Android platform
        if: \${{ inputs.add_android == 'true' }}
        run: npx cap add android
      - name: Patch Android Gradle (exclude legacy kotlin-stdlib modules)
        if: \${{ inputs.add_android == 'true' }}
        run: |
          GRADLE_FILE="android/app/build.gradle"
          if [ -f "$GRADLE_FILE" ] && ! grep -q "kotlin-stdlib-jdk7" "$GRADLE_FILE"; then
            printf "\\nconfigurations.all {\\n    exclude group: 'org.jetbrains.kotlin', module: 'kotlin-stdlib-jdk7'\\n    exclude group: 'org.jetbrains.kotlin', module: 'kotlin-stdlib-jdk8'\\n}\\n" >> "$GRADLE_FILE"
          fi
      - name: Add iOS platform
        if: \${{ inputs.add_ios == 'true' }}
        run: npx cap add ios
      - name: Patch iOS minimum deployment target
        if: \${{ inputs.add_ios == 'true' }}
        run: |
          PODFILE="ios/App/Podfile"
          if [ -f "$PODFILE" ]; then
            sed -i -E "s/platform :ios, '[0-9]+\\.[0-9]+'/platform :ios, '16.0'/" "$PODFILE"
          fi
      - name: Commit generated files
        run: |
          git config user.name "mobileflow-bot"
          git config user.email "bot@mobileflow.app"
          git add -A
          git diff --cached --quiet || git commit -m "chore: configure Capacitor (MobileFlow setup)"
          git push
`;
}
