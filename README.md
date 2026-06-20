# 🔮 Grimoire

> Inject lorebooks into JanitorAI chats. Your API key never leaves your browser.

Grimoire is a browser extension that lets you manage and inject lorebooks directly into your JanitorAI chats, without needing a proxy or handing your API key to anyone else.

## Why does this exist?

JanitorAI lorebooks are powerful, but the built-in system has limitations. Some tools work around this by routing your chats through a proxy server, which means handing your API key to a third party. That's a security risk.

Grimoire takes a different approach: everything happens inside your browser. No proxy, no server, no account to create.

## Features

- **Multiple lorebooks** - Create as many lorebooks as you want, toggle them on and off independently
- **Smart injection** - Lorebook entries are matched against your recent conversation and injected where relevant
- **Scan depth control** - Decide how far back in the conversation Grimoire should look for keyword matches
- **Import from SillyTavern** - Already have lorebooks in ST format? Import them directly
- **Live editing** - Edit your lorebooks in the side panel and see changes take effect immediately, no refresh needed
- **No signup, no account** - Install and go

## Install

### Browser stores (coming soon)

Grimoire will be available on the Chrome Web Store and Firefox Add-Ons.

### From source

1. Download or clone this repo
2. Open `chrome://extensions` in Chrome (or `about:debugging` in Firefox)
3. Turn on Developer Mode
4. Click "Load unpacked" and select the folder
5. Open the Grimoire side panel to start creating lorebooks

## Privacy

Grimoire doesn't collect data. It doesn't have a server. Your lorebooks and settings are stored on your device. Your LLM API key (OpenAI, OpenRouter, etc.) is never read or touched by Grimoire.

Full details: [PRIVACY.md](PRIVACY.md)

## How it works (the simple version)

When you send a message on JanitorAI, Grimoire checks if any of your lorebook entries are relevant based on keywords in the recent conversation. If they are, it quietly inserts them into the request before it reaches the AI. The AI then has that context available when generating its response.

This all happens instantly and transparently. You just chat normally and Grimoire handles the rest in the background.

## License

GPL v3. See [LICENSE](LICENSE).
