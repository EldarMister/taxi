# Driver history theme and language panel — 1.1.96

Implemented on 2026-10-06:

- History uses the existing application theme instead of forcing a light surface. Backgrounds, text, chart, separators, icons, financial chips, status bar, income explanation and the iOS date picker follow the selected theme. The blue chart accent remains blue in both themes.
- Only the highest positive income bucket is highlighted, including its date/time and amount. Equal maxima select the first bucket deterministically; empty periods have no highlighted peak. The graph consists of accessible, noninteractive views, so touching a column cannot change dates, period, totals, list or requests. The period controls and calendar remain the date-selection mechanisms.
- Card and bonus summary chips are hidden. Actual cash earnings, the original signed commission and the original income calculation remain intact. Financial calculations and API fields were preserved.
- Driver settings use the existing BottomPanel inside a native modal for language selection. The panel supports drag, backdrop and back-button dismissal, safe bottom spacing, scrollable choices, theme colors and hidden underlying accessibility content. Language changes use the existing saving mechanism; concurrent presses are fenced and failed saves keep the panel open.

Validation: TypeScript check passed. All 55 selected tests passed (driver history/account, theme, language persistence, bottom panel, application variant and UI contracts). Peak tests include a highest-earning interval different from the current hour/selected date; day, week and month retain their real ranges.

Native Android visual verification used actual application components, a local isolated API and its existing saved orders at 360 dp. The selected September range showed its real income and signed commission. Tapping a nonpeak column preserved all displayed labels, date, peak and rows. Both language themes were inspected; switching to Kyrgyz updated the real local profile, reopening retained its selection, and Russian was restored. Swiping the sheet closed restored the settings accessibility tree.

Screenshots:

- `screenshots/driver-history-dark-peak-360.png`
- `screenshots/driver-language-bottom-panel-dark-360.png`
- `screenshots/driver-language-bottom-panel-light-360.png`

Release: `mobile/builds/Atlas-driver-1.1.96-arm64.apk`, package `kg.taxigo.driver`, versionCode 107. Gradle release build succeeded. Manifest and ZIP inspection confirmed arm64-v8a only; Android signature matches the preceding APK. Production API and the real application entry were verified in the bundled release. Existing food artwork was also verified against decoded packaged pixels and alpha. SHA-256: `4f5a3fe8cd01f85192b561b1247205639aad69d3c03233cc5fa3733aff7c0f22`.

The ARM release was not installed in the x86 emulator; the native checks used the existing development binary with the actual updated screens. No server change or redeployment was needed for these UI changes.
