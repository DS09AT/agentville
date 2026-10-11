# Privacy and security

## What leaves your computer

Nothing, with two exceptions:

- the GitHub CLI (`gh`) asks GitHub about your own repos, if you installed it;
- the ✨ Helper, off by default, sends a few facts to Haiku through your own Claude Code: for a
  name, the session's first messages; for animal lines, agent and repo names, states and counts.
  It never sends code, paths, commands or conversation text for animal lines.

## Who can open the dashboard

By default only the computer Agentville runs on. Other sites open in your browser cannot read it or
act for you.

With **network access** on, other devices on your network can open it read-only.

- **They see:** each agent's name, folder, state, model and current tool, your repos with branches
  and pull requests, and the worlds.
- **They never get:** prompts, replies, questions, file names or contents, past sessions or
  settings. They cannot answer, message, start or stop anything.
- **Allowed and blocked addresses** limit which devices can connect. By default only private
  network addresses can.
- **Password:** a device that has not signed in gets a plain sign-in form and nothing else. Five
  wrong attempts block it for a minute. Changing the password signs every device out at once.
- **HTTPS** encrypts the connection. The certificate is self-signed, so each browser asks you to
  accept it once. Without HTTPS, the password and everything shown cross your network unencrypted.
  If HTTPS is on but its certificate can't be created, Agentville stays off the network.

Settings can only be changed on the computer Agentville runs on.

For access from outside your network use a VPN, not a forwarded port.

## What Agentville changes on your computer

- Its own folder, `~/.agentville`.
- A login entry, so it starts by itself.
- One entry in your Claude Code settings, so sessions load the mod.
- **↺ Restore** adds one line to the end of a session's transcript, as `/rewind` does.

`agentville uninstall` removes the login entry and the settings entry. Agentville never reads or
changes your Claude logins.

## What it stores

In `~/.agentville`, readable only by you:

- files you attached to a message, for 7 days;
- messages waiting for a session's turn to end;
- your notes on sessions;
- your settings, and the password as a hash.

## Files

- The file explorer shows what git shows. Ignored files and files that look like secrets (`.env`,
  keys) are neither listed nor shown.
- A session can only be started in your home folder or on a mounted drive.
- **Show in Finder** reveals a file. It never opens or runs it.

## Worlds

Built-in worlds (the farm, the factory) are part of Agentville.

A world from your folder is someone's code. Agentville limits what it can do:

- It can never act for you: it cannot answer, approve, message, start or stop anything.
- It cannot use your access to the dashboard.
- Until you tick **Can see what agents say** for it, it gets numbers instead of names, no text or
  paths, and cannot ask for files.

It cannot fully stop a world from sending what it is shown to another server. So add only worlds
you trust, and tick **Can see what agents say** only for a world whose author you would trust with
your agents' words.

`agentville check-world` runs a world's code on your computer with restricted file access, but the
world can still reach the network. Check only worlds you trust.
