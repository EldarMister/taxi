# Atlas website

React, Vite and Tailwind CSS landing page for Atlas and Atlas pro. The site has direct public routes for `/privacy/`, `/terms/` and `/drivers/` so mobile apps can open them without client-side routing rules.

## Run locally

```powershell
npm install
npm run dev
```

Run these commands from `web/`. `npm run build` creates the static site in `web/dist/`.

The build script looks for the newest `Atlas-client-X.Y.Z.apk` and `Atlas-driver-X.Y.Z.apk` in `mobile/builds/`. If found, it copies them into the site's downloads folder and records the size, version and SHA-256. APK files are intentionally excluded from Git. A build from a fresh checkout without the APK files succeeds, but the direct APK buttons stay unavailable. For a hosted build, either provide both files in `mobile/builds/` before building or configure `VITE_CLIENT_APK_URL` and `VITE_DRIVER_APK_URL` to point to hosted files.

## Before publishing

1. Replace every highlighted `[указать …]` and `[уточнить …]` in the privacy policy and terms with confirmed operator details, support contact, data retention rules and final service terms. Review both documents against actual data flows.
2. Add published store URLs in `web/.env` using the four variables from `.env.example`. Missing store links appear as “Скоро” instead of pointing to search results or unrelated applications.
3. Publish the static `dist/` folder at the intended domain. Check `https://YOUR-DOMAIN/privacy/`, `/terms/` and `/drivers/` directly, along with both APK downloads.
4. Set `EXPO_PUBLIC_PRIVACY_URL=https://YOUR-DOMAIN/privacy/` and `EXPO_PUBLIC_TERMS_URL=https://YOUR-DOMAIN/terms/` for both mobile variants, then rebuild the apps. The login and support screens expose the links when these values are set.

## Add product screenshots

The landing page has five neutral media slots. Put approved screenshots in `web/public/images/`, then set each `src` in `web/src/media.js` to its public path (for example, `src: '/images/atlas-home-new.png'`). Until then, each slot shows a simple Atlas placeholder without a simulated app interface.

| Slot | Where it appears |
| --- | --- |
| `clientHome` | Main phone in the hero |
| `clientRide` | Ride phone in the hero |
| `clientFood` | Food phone in the hero |
| `driverPreview` | Wide Atlas pro preview |
| `driverPhone` | Atlas pro phone |

Store buttons intentionally remain unavailable until real listing URLs are supplied.

## Brand artwork

The services section uses the transparent illustration at `public/images/atlas-services.png`, created with the built-in imagegen tool. The complete final prompt is saved in `design/atlas-services.prompt.md`.
