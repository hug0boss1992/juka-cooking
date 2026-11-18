# Juka Cooking

Statische Link-in-Bio-Seite für `@juka.cooking`. GitHub Actions baut die Startseite aus `links.md` und veröffentlicht `public/` auf GitHub Pages.

## Einrichtung ab der E-Mail-Bestätigung

1. **E-Mail bestätigen.** Prüft zuerst, ob ihr die in der Vorlage verwendete Kontaktadresse `juka.cooking@gmail.com` tatsächlich nutzen wollt und Zugang dazu habt. Bestätigungscodes und Passwörter gebt ihr beim jeweiligen Dienst selbst ein. Bei einer anderen Adresse passt ihr `links.md`, `public/impressum.html` und `public/datenschutz.html` an.
2. **Rechtstexte fertigstellen.** Die Kontoinhaberin füllt die mit `<mark>` gekennzeichneten Felder in `public/impressum.html` und `public/datenschutz.html` aus, prüft die Angaben und entfernt die Vorlagenhinweise. Prüft auch die zwei übernommenen Partnerlinks und den Rabattcode vor dem Start. Alles, was ihr in ein öffentliches Repository hochladet, ist dort öffentlich einsehbar, einschließlich der Versionshistorie.
3. **GitHub einrichten.** Mit Justynas bestätigtem GitHub-Konto ein leeres öffentliches Repository anlegen, etwa `juka-cooking`. Den Projektordner `juka-cooking` als Repository hochladen, sodass `.github/`, `public/`, `scripts/` und `links.md` in der obersten Ebene erscheinen. Die Git-Befehle für ein neues leeres Repository stehen unten. [GitHub-Anleitung zum Hochladen](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
4. **Pages einschalten.** Unter **Settings → Pages → Build and deployment → Source** die Option **GitHub Actions** auswählen. Unter **Actions → Instagram-Feed und GitHub Pages → Run workflow** den Standardbranch auswählen. Nach erfolgreichem Lauf **Settings → Pages → Visit site** öffnen. Links und Rechtstexte prüfen und die Adresse in die Instagram-Bio eintragen. [GitHub-Pages-Anleitung](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
5. **Behold verbinden.** Die Kontoinhaberin verbindet ihr professionelles Instagram-Konto bei Behold, legt einen JSON-Feed mit sechs Beiträgen an, aktiviert alle gewünschten Beitragstypen und lässt die Domain-Whitelist für GitHub Actions leer. Für die neuesten Beiträge aus allen Veröffentlichungen auch „Show off-feed reels“ aktivieren. Unter **Settings → Secrets and variables → Actions → Variables** die Repository-Variable `BEHOLD_FEED_URL` mit der öffentlichen Feed-Adresse anlegen und den Workflow erneut starten. Titelbilder und Beitragslinks prüfen. [Behold-Anleitung](https://behold.so/docs/json-feeds/)

### Erster Upload über Git

PowerShell im Projektordner `juka-cooking` öffnen und `GITHUB-NAME` durch Justynas GitHub-Benutzernamen ersetzen. Falls das Repository anders heißt, auch `juka-cooking` in der URL ersetzen.

```powershell
git init -b main
git add --all
git commit -m "Juka Cooking veröffentlichen"
git remote add origin https://github.com/GITHUB-NAME/juka-cooking.git
git push -u origin main
```

Falls Git nach einer Commit-Identität fragt, den Namen und eine mit GitHub verknüpfte E-Mail-Adresse oder die GitHub-Noreply-Adresse im lokalen Repository konfigurieren. Die GitHub-Anmeldung erfolgt über den Browser, wenn Git Credential Manager dazu auffordert.

## Links und Bio ändern

1. Im GitHub-Repository **links.md** öffnen und auf den Stift **Edit this file** tippen. Die Datei lässt sich im Handy-Browser als Lesezeichen speichern.
2. Für einen Link eine vorhandene Zeile kopieren. Den Namen zwischen `[]` und die Adresse zwischen `()` ersetzen. So sieht eine Beispielzeile aus.

   ```markdown
   - [Meine Rezepte](https://example.com/rezepte)
   ```

   Werbung unter **Partnerlinks** ergänzen. Die Seite setzt „Anzeige“ automatisch. Zum Umordnen Zeilen verschieben, zum Entfernen die ganze Zeile löschen. Die Bio steht im Abschnitt **Bio**.
3. **Commit changes** wählen und auf dem Standardbranch speichern. Die Änderung geht mit dem nächsten erfolgreichen Pages-Lauf online. Bei einer ungültigen Zeile nennt der Workflow die Zeilennummer. Die letzte erfolgreiche Version bleibt online. [Dateien im GitHub-Browsereditor bearbeiten](https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files)

## Rezepte aktualisieren

Die Rezeptseiten unter `public/rezepte/` werden lokal erzeugt, weil die vollständigen Beschreibungen und die Instagram-Statistiken nur im Ordner `intern/` liegen (nicht im Repository):

```
node scripts/publish-recipes.mjs
node scripts/build-site.mjs
```

Sortiert wird nach Aufrufen aus dem Instagram-Export (`intern/rezepte-beliebtheit.json`). Doppelt gepostete Rezepte sind in `intern/rezepte-quelle.json` mit `doppeltVon` markiert. Rezepte mit offener Frage stehen in `hidden` in `scripts/publish-recipes.mjs` und werden erst nach Klärung gezeigt. Die Startseite zeigt die sechs beliebtesten Rezepte aus `public/rezepte/rezepte.json`.

## Betrieb

- Beim täglichen Lauf um 05:23 UTC und beim manuellen Start ruft GitHub den Behold-Feed je einmal ab. Der Gratisfeed liefert bis zu sechs Beiträge pro Abruf. Der Workflow fügt sie ohne Duplikate zum Archiv `public/feed.json` hinzu und behält bereits erfasste Beiträge. Der Reiter zeigt die neuesten Beiträge zuerst und lädt über „Mehr Beiträge“ jeweils zwölf weitere Vorschaubilder aus `public/feed/`. Beiträge vor dem ersten Abruf brauchen einen eigenen Import. Wenn mehr als sechs neue Beiträge zwischen zwei erfassten Feed-Ständen erscheinen, können ältere davon im Archiv fehlen. [Behold-Tarifgrenzen](https://behold.so/pricing/)
- Füge den Instagram-Kurzcode eines Beitrags in `public/feed.json` unter `excluded` ein, wenn er von der Website verschwinden soll. Beim nächsten Feed-Lauf entfernt der Workflow den Beitrag aus der veröffentlichten Liste und hält ihn auch bei weiteren Abrufen aus dem Archiv heraus. Löschungen und Änderungen der Sichtbarkeit auf Instagram werden nicht automatisch im Archiv nachvollzogen.
- Der Workflow committet geänderte Feed-Dateien und setzt beim ersten geplanten Lauf im Monat eine Monatsmarke im Repository. Die Marke hält Repository-Aktivität fest, auch wenn sich der Feed nicht ändert. Bei einem Feed-Fehler bleibt die letzte veröffentlichte Fassung online. GitHub kann Zeitpläne in öffentlichen Repositorys nach 60 Tagen Inaktivität abschalten. Falls das passiert, den Workflow im Actions-Tab wieder aktivieren. [GitHub-Zeitpläne](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- GitHub Pages beschränkt die Nutzung für Websites, die in erster Linie geschäftlichen Transaktionen dienen. Für diese Linkseite ist Cloudflare Pages der vorgesehene Ausweichhoster. Bei einem Wechsel das gleiche Repository, `node scripts/build-site.mjs` als Build-Befehl und `public/` als Ausgabeverzeichnis verwenden. Die automatische Feed-Veröffentlichung prüfen und den Hosting-Abschnitt der Datenschutzerklärung auf den tatsächlich verwendeten Hoster umstellen. [GitHub-Pages-Nutzungsgrenzen](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits#usage-limits)

## Automatischen TikTok-Abruf verbinden

1. Im TikTok Developer Portal eine App mit **Desktop** als Plattform und den Produkten Login Kit und TikTok API für Display API einrichten. Die App benötigt `user.info.basic` und `video.list`. Als Desktop-Redirect-URI exakt `http://127.0.0.1:3455/callback/` eintragen. Produktionszugriff setzt TikToks Prüfung und URL-Verifizierung voraus. Die Website kann währenddessen schon den direkten TikTok-Profillink anzeigen. [App-Einrichtung](https://developers.tiktok.com/docs/en/getting-started-create-an-app) · [Desktop Login Kit](https://developers.tiktok.com/docs/en/login-kit-desktop)
2. Im GitHub-Repository unter **Settings → Environments** die Umgebung `tiktok-feed` für den Standardbranch einrichten und dort `TIKTOK_CLIENT_SECRET` als Umgebungssecret eintragen. Unter **Settings → Secrets and variables → Actions → Variables** `TIKTOK_CLIENT_KEY` als Repository-Variable anlegen. Für die automatische Token-Erneuerung benötigt ihr einen Fine-grained GitHub-Token mit **Environments: Read and write** für dieses eine Repository. Hinterlegt ihn als Umgebungssecret `TIKTOK_SECRET_WRITER`. Er muss vor Ablauf ersetzt werden. [GitHub-Berechtigung](https://docs.github.com/en/rest/actions/secrets#create-or-update-an-environment-secret)
3. Den einmaligen Verbindungshelfer im Projektordner mit PowerShell 7.2 oder neuer, Node.js und installierter GitHub CLI (`gh`) starten. Setzt die Werte nur für die laufende PowerShell-Sitzung. Gebt die Geheimnisse in die verdeckten Eingabefelder ein. Ersetzt `GITHUB-NAME/REPO` durch euer tatsächliches Repository.

   ```powershell
   $env:TIKTOK_CLIENT_KEY = Read-Host 'TikTok Client Key'
   $env:TIKTOK_CLIENT_SECRET = Read-Host 'TikTok Client Secret' -MaskInput
   $env:TIKTOK_SECRET_WRITER = Read-Host 'GitHub-Token für Umgebungssecrets' -MaskInput
   node scripts/connect-tiktok.mjs GITHUB-NAME/REPO
   Remove-Item Env:TIKTOK_CLIENT_KEY,Env:TIKTOK_CLIENT_SECRET,Env:TIKTOK_SECRET_WRITER
   ```

   Die Kontoinhaberin öffnet die ausgegebene Adresse und autorisiert `@juka.cooking` bei TikTok. Der Helfer legt den Refresh-Token direkt als Secret `TIKTOK_REFRESH_TOKEN` in der Umgebung ab.
4. Unter **Settings → Secrets and variables → Actions → Variables** die Repository-Variable `TIKTOK_ENABLED` auf `true` setzen und den Workflow **Instagram-Feed und GitHub Pages** manuell starten. Danach die TikTok-Kacheln auf der veröffentlichten Seite prüfen. Wenn TikTok nicht erreichbar ist, bleibt die Website mit direktem Profil-Link verfügbar. Details stehen im Workflow-Lauf.

GitHub liest bis zu 60 öffentliche TikTok-Videos und prüft daraus bis zu 24 über mehrere Seiten verteilte Titelbilder. Ähnliche Titelbilder und Texte werden mit dem Instagram-Feed und innerhalb des TikTok-Bestands abgeglichen. Stärker bearbeitete Crossposts können dadurchrutschen. Der Browser wählt bis zu sechs Videos aus dem bereinigten Bestand. TikTok-Titelbilder und die generierte Liste werden beim Veröffentlichen in die statische Seite gepackt. Sie landen außerhalb der öffentlichen Git-Historie. [TikTok-Videoliste](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list)
