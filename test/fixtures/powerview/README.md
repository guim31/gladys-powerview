# PowerView hub fixtures

Real answers of PowerView hubs (Generation 1, 2 and 3), taken from the test
fixtures of [`aiopvapi`](https://github.com/sander76/aio-powerview-api) (also
used by the Home Assistant `hunterdouglas_powerview` tests).

Changes made here: the private IP addresses were replaced by documentation
addresses (`192.0.2.x`), and the cloud home id, the owner email and the
coordinates by invented values. The serial numbers and MAC addresses of the
original fixtures are already placeholders. The `shade_api_class` key of each
shade is not sent by a hub: `aiopvapi` added it to name the shade class it
builds, and the tests use it to check the type table of `src/powerview/shade.js`.

| File                                                       | Hub request                                    |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `gen1/fwversion.json`, `gen2/fwversion.json`               | `GET /api/fwversion`                           |
| `gen1/userdata.json`, `gen2/userdata.json`                 | `GET /api/userdata`                            |
| `gen1/shades.json`, `gen2/shades.json`                     | `GET /api/shades`                              |
| `gen1/scenes.json`, `gen2/scenes.json`                     | `GET /api/scenes`                              |
| `gen1/rooms.json`, `gen2/rooms.json`                       | `GET /api/rooms`                               |
| `gen1/scenemembers.json`, `gen2/scenemembers.json`         | `GET /api/scenemembers`                        |
| `gen3/gateway/info.json`                                   | `GET /gateway/info`                            |
| `gen3/gateway/primary.json`, `gen3/gateway/secondary.json` | `GET /gateway` (primary and secondary gateway) |
| `gen3/home/home.json`                                      | `GET /home`                                    |
| `gen3/home/shades.json`                                    | `GET /home/shades`                             |
| `gen3/home/scenes.json`                                    | `GET /home/scenes`                             |
| `gen3/home/rooms.json`                                     | `GET /home/rooms`                              |

## License of the fixtures

```
BSD 3-Clause License

Copyright (c) 2017, Sander Teunissen
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
