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
3. Deploy the website independently with Root Directory `/web` and `Dockerfile`. The website, admin panel (`web/admin/dist`), proxy configuration and public APK downloads all belong to this directory. Set `API_UPSTREAM` to the separate application's private address. The API uses the root `Dockerfile.railway` and does not contain website files. Follow [the hosting guide](../docs/HOSTING.md). Check the public pages, admin login, Socket.IO and both APK downloads.
4. Set `EXPO_PUBLIC_PRIVACY_URL=https://YOUR-DOMAIN/privacy/` and `EXPO_PUBLIC_TERMS_URL=https://YOUR-DOMAIN/terms/` for both mobile variants, then rebuild the apps. The login and support screens expose the links when these values are set.

## Add product screenshots

Product images are configured in `web/src/media.js`. The three hero phones use unchanged copies of `mobile/assets/скриншот1.jpg`, `скриншот2.jpg` and `скриншот3.jpg`, stored in `public/images/` as `atlas-screen-1.jpg`, `atlas-screen-2.jpg` and `atlas-screen-3.jpg`. The Atlas pro section uses a generated explanatory cover with separate desktop and mobile compositions. The driver guide phone still shows a neutral placeholder until an approved screenshot is supplied.

| Slot | Where it appears |
| --- | --- |
| `clientHome` | Center hero phone — `скриншот2.jpg` |
| `clientRide` | Left hero phone — `скриншот1.jpg` |
| `clientFood` | Right hero phone — `скриншот3.jpg` |
| `driverPreview` | Atlas pro cover — landscape on desktop, portrait at 760px and below |
| `driverPhone` | Atlas pro phone in the driver guide — placeholder |

To replace an image, put it in `web/public/images/` and update its `src`. For an alternate mobile composition, also set `mobileSrc`. Cover generation prompts and source references are saved in `design/atlas-pro-cover.prompt.md`.

Store buttons intentionally remain unavailable until real listing URLs are supplied.

## Brand artwork

The services section uses the original illustration at `public/images/atlas-services.png`, restored at the user's request. Its prompt is saved in `design/atlas-services.prompt.md`.

Logos are original image copies. Atlas and Atlas pro app icons have rounded corners in every placement. Download cards and the product menu use `atlas-client-original.png` for Atlas and `atlas-pro-original.png` for Atlas pro. The header retains the original `atlas-logo.png` wordmark. The hero badge, Atlas pro section badge and feature chip, services badge, and footer use the supplied `atlas-chevron-supplied.png` transparent black chevron. On the dark section, a light backing makes the black image visible without recoloring it. Other general brand placements use `atlas-brand-original.png`. All three hero phones remain visible on mobile and desktop.

The current Atlas pro cover assets are `atlas-pro-cover-refined.png` and `atlas-pro-cover-mobile-refined.png`. They preserve the original light screenshot appearance, with restrained graphite surroundings and a neutral A monogram avatar in the profile screen. Generation and edit prompts are recorded in `design/atlas-pro-cover.prompt.md`.

## Railway source

The independent website service is connected to `EldarMister/taxi`, branch `codex/driver-road-signs`, with Root Directory `/web`. GitHub pushes trigger deployment. The live site is https://atlas-app.up.railway.app/ and its admin panel is `/admin/`. The application API retains its existing separate service and hostname.
