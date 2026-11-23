# How the app is opened, and where it starts (#112)

The app keeps no "last page". The address decides what opens:

| Address | Opens |
| --- | --- |
| the site's root, `#/` | *Your games* (or email entry for a browser with no player) |
| `#/game/<id>` | that game |
| `#/join/<token>`, `#/friend/<token>` | that invitation |
| `#/local`, `#/local/chess960` | play on one device |

So a launch lands on an old game only when whatever launched it carries that game's address.
The report behind #112 (phone launches landing on an old finished chess game) is that case.
The owner's phone is an iPhone and the app is opened from a Home Screen icon. After the change
went live he confirmed that the icon opens *Your games* and no longer the old game. See the
last section.

## Launch paths

| How the app is opened | What it opens | Can the app change it? | What was done |
| --- | --- | --- | --- |
| Typing or bookmarking the site's address | the root: *Your games* | already right | nothing |
| A link someone sent (game, invitation) | its destination | must not change | nothing; tested |
| Reloading a page | the same page | must not change | nothing; tested |
| Coming back to the browser or app from the background | the same page, as left | must not change | nothing; tested |
| A browser tab the phone kept, or restored after closing | the page that tab was on | **no**: to the app it is a reload or a restored page, the same as a deliberate one | nothing. Close the tab, or tap *FriendlyGames* in the top bar |
| A bookmark made while a game was open | that game | **no**: it is an explicit address | make the bookmark on *Your games* |
| A **new** Home Screen icon (iPhone, iPad, Android) | the manifest's `start_url`: *Your games* | **yes** | `public/manifest.webmanifest` with `start_url: "/"` |
| An **existing** iPhone or iPad Home Screen icon made while a game or invitation was open | iOS starts it at that address on every cold start | **yes, in the app** | on such a start the app goes to *Your games* (`src/shared/launch.ts`) |
| An **existing** Android Home Screen shortcut made while a game was open | Chrome opens that address in a tab | **no**: indistinguishable from a link | remove it and add it again from *Your games* |

## The iPhone Home Screen rule

An iPhone or iPad icon opens the site as a web app, and since iOS 26 every Home Screen icon does
by default, with or without a manifest. Each cold start loads the address the icon was made
with. The app recognises exactly this and starts on *Your games* instead:

- it runs as a Home Screen web app (`navigator.standalone` is true, which only iOS sets), **and**
- the page load is a fresh start (navigation type `navigate`, and this session has not run the
  app before), **and**
- the address is a game or an invitation.

Why that cannot be a link someone meant to open: on iOS a link from Messages, Mail or a web page
opens in the browser, never inside a Home Screen web app, and the web app has no address bar.
A reload inside the web app is not a fresh start, so an opened game stays open. The game itself
is never touched; it is in the *Your games* list. An icon made on *Your games* or on one-device
play is left alone.

Consequence to know: nobody can make an iPhone icon that opens one particular game. It opens
*Your games*, with that game in the list.

## The manifest

`public/manifest.webmanifest` names the app and sets `start_url` and `scope` to the root.
A manifest's `start_url` is what "prevents the app from starting on whatever page the user was
on" when it was added. `display` is `browser`: the site asks for nothing beyond a normal
browser page. iOS 26 opens Home Screen icons as web apps regardless, unless the person turns
*Open as Web App* off when adding.

An icon stores its address when it is made. Adding the manifest does not change icons that
already exist; that is what the rule above is for on iOS.

Two things about Home Screen web apps on iOS that are not new but are easy to trip over:
their storage is separate from Safari's, so the icon asks for your email once even if Safari
knows you; and an invitation link tapped in Messages opens in Safari, not in the icon's app.

## What is and is not verified

- Verified by tests in a desktop browser and an emulated phone: root entry, explicit game and
  invitation links, reload, return from the background, and the Home Screen rule with
  `navigator.standalone` set by the test.
- **Observed by the owner on his iPhone (2026-11-22, site at `9525a76`):** opening the app
  from the Home Screen no longer goes to the old game; it opens the game list. Before the
  change (2026-11-21) he had said the phone is an iPhone and that it was probably the Home
  Screen icon.
- **Not stated in that observation:** whether it was the same icon as before or a newly added
  one, and whether the app had been closed first. Both cases are meant to open *Your games*:
  an existing icon through the rule above, a new one through the manifest as well.
- **Still not verified on a device:** that Android uses the manifest's `start_url` for a new
  icon on this site (taken from its documentation), and how iOS 26 treats `display: browser`.

Sources: [WebKit: features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
(every site added to the Home Screen opens as a web app by default);
[web.dev: Add a web app manifest](https://web.dev/articles/add-manifest) (`start_url`, `display`, `scope`);
[firt.dev: iOS PWA compatibility](https://firt.dev/notes/pwa-ios/) (separate storage, no link capturing).
