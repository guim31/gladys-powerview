# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **No secret.** The local API of the PowerView hubs has no password, no token
  and no account: the configuration holds hub IP addresses, a language and a
  refresh interval, nothing else. The PowerView cloud is never contacted.
- **`/data`** holds `powerview-state.json`: the hubs seen so far (address,
  generation, name, firmware) with the shade, scene and room entries they
  answered, so a restart knows them before the first discovery. Deleting it is
  harmless.
- **Network**: plain HTTP to the hubs on the local network (port 80, the only
  protocol they speak), and the mDNS discovery run by the Gladys core for the
  container. Anyone on that network can drive the shades through the hub, with
  or without this integration: protect the network, not the hub.
- Shades are not a security device: nothing here opens a door or disarms an
  alarm.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the PowerView hubs, apps and cloud, and their firmware.
