# Rondo

Rondo is a ball-headed organizer in a clay-red scarf, under the floodlights of an evening football pitch. A full forehead pentagon and two cropped side pentagons frame the light face, with seams joining the surrounding panels. The open arc and dot below the ball trace a pass around the circle.

## Palette

| Colour | Hex | Application |
| --- | --- | --- |
| Dusk | `#211625` | Ink, dark tile and banner field |
| Aubergine | `#301F35` | Secondary dark field |
| Fired Clay | `#CB543B` | Passing arc on light surfaces, scarf reference |
| Floodlight | `#FFB46B` | Passing arc and head outline on dark surfaces |
| Chalk | `#FFF1D8` | Face and banner lettering |
| Deep Clay | `#8D4748` | Telegram avatar rim |
| Warm Clay | `#B86951` | Outer Telegram avatar keyline |
| Warm White | `#FFFBF3` | Monochrome face |
| Charcoal | `#232023` | Monochrome line work |

| Pairing | WCAG contrast | Use |
| --- | ---: | --- |
| Chalk and Dusk | 15.61:1 | AAA normal text, face and line work |
| Chalk and Aubergine | 13.71:1 | AAA normal text |
| Floodlight and Dusk | 9.94:1 | AAA normal text, dark-background arc |
| Floodlight and Aubergine | 8.73:1 | AAA normal text, dark-background arc |
| Fired Clay and Chalk | 3.87:1 | AA large text and graphics, light-background arc |
| Fired Clay and white | 4.31:1 | AA large text and graphics, light-background arc |
| Fired Clay and Dusk | 4.04:1 | AA large text and graphics |
| Floodlight and Chalk | 1.57:1 | Decorative accents |
| Warm White and Charcoal | 15.62:1 | AAA normal text, monochrome mark |
| Warm Clay and Telegram Dark `#17212B` | 4.02:1 | Avatar keyline |
| Warm Clay and Telegram Light `#EDF3F7` | 3.62:1 | Avatar keyline |

Ratios use solid sRGB values. Use Chalk and Dusk for copy. The illustrated palette contains additional tones for pitch lighting, fabric and rain.

## Mark, spacing and size

- Use `mark.svg` or `mark-light.svg` on white and other light, quiet surfaces. On dark surfaces use `mark-dark.svg` with its Floodlight outline and passing arc.
- Use `mark-mono.svg` for neutral applications. It has a Warm White face with Charcoal line work. Preserve the light face across all versions.
- Keep at least one eighth of the head diameter clear beyond the outline, arc and dot. Around the wordmark, keep at least half a lowercase letter height clear. When combining the two, measure the gap from the mark's outermost point to the R.
- Use the 16 px ICO frame for tiny browser icons. It drops the arc and fine seams to give the pentagons and face more room. Use the full standalone mark from 32 px; the finest seam detail is clearer at 48 px and above. Set the wordmark at 96 px wide or larger.
- Use the avatar at 40 px or larger in a circle. The face, eyes, grin and thumbs-up sit within its central 80% diameter. The warm rim carries the edge across light and dark chat backgrounds.
- Use `icon-maskable-512.png` where the platform applies its own mask. The complete mark fits inside the central 80%-diameter circle. The Dusk tile extends to the edges. Use the opaque `apple-icon.png` for Apple touch icons.

## Artwork

- Keep the ball round, with dark pentagons, light panels and visible connecting seams. Keep the face light and give it room between the panels. Use the passing arc and dot together in the full mark. Keep the plain jacket sleeves and amber ring zipper pull in the illustrations.
- Avoid stretching, rotating or reversing the mark, redrawing the panels, recolouring the face, or placing the transparent mark directly over busy photos.
- Use the spot PNGs for sign-up, balanced teams, rain cancellations and statistics. Keep them free of lettering. The WebP exports preserve more of the paper grain at smaller file sizes.

## Type and licences

- **Bricolage Grotesque** by Mathieu Triay and the Bricolage Grotesque Project Authors. The wordmark carries over Direction A's outlined glyphs at weight 765, width 97 and optical size 68, with custom spacing. It uses Dusk in the standalone SVG and Chalk in the banners. Licensed under SIL Open Font License 1.1. [Upstream licence](https://github.com/google/fonts/blob/main/ofl/bricolagegrotesque/OFL.txt)
- **Noto Sans Regular v2.015** by The Noto Project Authors. Used for the numeric sizing labels on the contact sheet. Licensed under SIL Open Font License 1.1. [Upstream licence](https://github.com/notofonts/latin-greek-cyrillic/blob/main/OFL.txt)

The wordmark is made of paths and the sheet labels are rasterized.

## Contact sheet

From top to bottom, the sheet shows the mark at 16, 32, 48, 64, 128 and 512 px, then the four background variants, wordmark and palette. Below are the avatar at 40, 64 and 128 px on light and dark chat backgrounds, both avatar exports, all five icon assets and the 16, 32 and 48 px favicon frames. The next two rows show Open Graph, GitHub, README and bot description. The spot row shows sign-up, teams, rain and statistics. The bottom strip shows the three banner WebPs followed by the four spot WebPs in the same order.

## SIL Open Font License 1.1

Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)

Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)

The following licence applies to both typefaces.

```text
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

```
