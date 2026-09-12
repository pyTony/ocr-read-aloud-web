import { PageUnit, OcrLine } from '../types';
import { mergeLinesToChunks } from './layoutAndColumns';
import { parseContinuedFrom, parseContinuedOn } from './continueLinks';
import { looksLikeAd } from './adDetection';
import { inferPageTitle } from './articleExport';

// Raw dump from 1976_08_BYTE_00-12_Speech_Synthesis.ocr.txt
const SAMPLE_OCR_TEXT = `=== Page 1 ===
ISSUE NUMBER 12
AUGUST 1976
$1.50 IN NORTH AMERICA
($2.50 ELSEWHERE)
BYTE
PRINTED IN USA
the small systems journal
SPEECH
SYNTHESIS
BY
COMPUTER

=== Page 2 ===
NEED HARDCOPY?
If you are one of the many computer users who wants hardcopy printouts, but can't afford any of the available machines, your troubles are over. Our PR-40 is a universal printer that gives you clear easy to read hardcopy like the sample on the right with almost any computer. Our printer operates from any eight bit parallel I/O port. The printer has it's own character generator and memory buffer. This means that the computers only job is to feed data when the printer is ready.
No special program is needed in the computer to convert the data to a form that the printer can use as each character is printed. The PR-40 is easy to use, easy to interface and easy to afford.
* SWTPC PR-40 ALPHANUMERIC PRINTER *
of: 40 CHARACTERS / LINE * 5 x 7 DOT MATRIX DISPLAY * USES STANDARD 3 7/8" CALCULATOR PAPER
* 75 LINES PER MINUTE * AUTOMATIC RIBBON REVERSE * 64 CHARACTER ASCII CHARACTER SET
* 40 CHARACTER LINE BUFFER * TTL, SWTPC 6800, MITS COMPATIBLE
PR-40 LINE PRINTER KIT ... $250.00 PPd
HOW ABOUT PICTURES?
Games are more fun with pictures. Now you can add graphics displays to your game programs and on any type computer. Our GT-6144 operates from any eight bit parallel I/O port. It has it's own self contained memory, so memory space for the display is not robbed from your computer. The 9Y2 x 13 circuit board contains all you need to produce a graphic display like the one of the starship "Enterprise" shown on the left. Kit is less power supply, or chassis.
GT-6144 GRAPHICS TERMINAL KIT .. $ 98.50 PPd
I know a bargain when I see it. Send the following:
NAME ____________________
ADDRESS ____________________
CITY STATE ZIP ____________________
[ ] 6800 Computer $395.00 [ ] PR-40 Printer $250.00 [ ] GT-6144 Graphics Terminal $ 98.50 [ ] Just data (free)
Southwest Technical Products Corp. Box 32040, San Antonio, Texas 78284

=== Page 3 ===
Cromemco's popular BYTESAVER™ memory board gives you two of the most-wanted features in microcomputer work: (1) a simple, easy way to store your computer programs in programmable read only memory (PROM). (2) a PROM memory board with the capacity for a full 8K bytes of PROM memory storage.
ECONOMICAL The BYTESAVERTM is both a place and a way to store programs economically. It transfers programs from the non-permanent computer RAM memory to the permanent PROM memory in the BYTESAVERTM. Once your program is in the BYTE-SAVERTM, it's protected from power turn-offs, intentional or accidental. The PROMs used with BYTESAVERTM are UV erasable and can be used again and again.
The BYTESAVERTM itself plugs directly into your Altair 8800 or IMSA18080.
PROM PROGRAMMER Many people are surprised to learn that in the BYTESAVERTM you also have your own PROM programmer. But it's so. And it saves you up to hundreds of dollars, since you no longer need to buy one separately.
The built-in programmer is designed for the 2704 and 2708 PROMs. The 2708 holds 1 K bytes, four times the capacity of the well-known older 1702 PROM (yet cost-per-byte is about the same). The 2708 is also fast - it lets your computer work at its speed without a wait state. And it's low-powered. With 2708's in all 8 sockets, the BYTESAVERTM is still within MITS bus specifications, drawing only about 500 mA from the +8V bus. A complement of 2708 PROMs gives the BYTESAVERTM its full 8K capacity.
HOLDS LARGE PROGRAMS The BYTESAVER'sTM 8K-byte capacity lets you store the larger and more powerful programs. 8K BASIC, for example, easily fits in the BYTESAVERTM capacity of 8 PROMs. One 1 K PROM will hold many games such as Cromemco's DAZZLER-LIFE or DAZZLE-WRITER.
NO KEYBOARD NEEDED The BYTESAVERTM comes with special software programmed into a 2704 PROM. This software controls transfer of the computer RAM content to the BYTESAVERTM PROM.
So you are ready to go. You don't need a keyboard. Just set the computer sense switches as instructed in the BYTESAVERTM documentation.
Transfer of memory content to PROM ("burning") takes less than a minute. The BYTESAVERTM software controls computer lights to verify complete and accurate transfer of memory content.
The software also programs any of the other 7 PROM positions in the BYTESAVERTM as readily as the first.
And when used to transfer information from the BYTESAVERTM PROMs to RAM, the special design of the software allows loading a large program such as 8K BASIC in one second.
AVAILABLE NOW - STORE/MAIL
The BYTESAVERTM is sold at computer stores from coast to coast. Or order by mail from Cromemco. Cromemco ships promptly. You can have the BYTESAVERTM in your computer within a week after your order is received.
BYTESAVERTM kit $195 (Model BKBS-K)
BYTESAVERTM assembled $295 (Model BKBS-W)
Shipped prepaid if fully paid with order. California users add 6% sales tax. Mastercharge and BankAmericard accepted with signed order.
Cromemco Specialists in computer peripherals
2432 Charleston Rd., Mountain View, CA 94043 • (415) 964-7400

=== Page 4 ===
In This Issue: HARD PALATE
What's good about four billion bytes on-line capacity, 10 to 50 ms access time, and a system cost in the personal computing category? Find out by reading Martin Buchanan's article on "What Do You Do With a Video Disk?"
"Friends, Humans, and Countryrobots: Lend Me Your Ears." When you've reached a point in your audio output micro-experimentation where the computer can talk, you'll have quite an accomplishment. D. Lloyd Rice describes some of the background information needed to create a human vocal tract model with computer control in his excellent tutorial on the subject. Imagine Star Trek implemented with a real ship's computer output!
What plugs into one Altair or IMSAI compatible bus slot, eats serial phoneme snacks, talks back and won't shut up till you pull the plug? Find out by reading Wirt Atmar's historical background and description of a new Altair compatible plug-in voice synthesizer, a commercial version of the prototype which was demonstrated as a prize-winning entry in the recent MITS World Altair Computer Convention. Once you get the hang of its accent, your talking computer will add a new dimension to conversational software.
What's wrong with the 8080 processor architecture? Ask a programmer for "features" and you'll get some answers. An analysis followed by definition of improvements resulted in the new Zilog Z80 microprocessor which is the ultimate in 8-bit microprocessors at this point in time. Find out what the Z80 is all about by reading Burt Hashizume's Microprocessor Update: Zilog Z80.
The act of programming, like any act of creation, requires a bit of organization and discipline on the part of the thinker. In the second reprint from Nat Wadsworth's Machine Language Programming for the "8008" (and similar microcomputers) you'll find some thoughts on the design and planning of programs.
In May BYTE, we had A Date With KIM. Here is the next chapter in the continuing story of True Confessions: How I Relate to KIM. Turn to Yogesh M Gupta's account of modifications to the KIM-1 system which achieve compatibility with slower memories, bus expansion, and a priority interrupt capability.
A sub theme of this BYTE is the idea of the talking personal computer system. Well, Jack Hemenway and Robert Grappel got together recently to concoct an allegorical tale of Jack's assembler. In Jack and the Machine Talk you'll see a dialogue with a computer personified. Which leads to the next step: Who'll be the first reader to create a program to implement the computer side of the dialogue, using one of the new voice output devices which are coming to market?
Want to experiment with high level languages (like APL) that require an extended character set? Want to simply build and utilize a convenient text display output device? Need upper and lower case displays for a text editor? If so, and if you can get by with a 32 character line on a standard TV set or monitor, then Dr Robert Suding's latest article will be of interest. Build a TV Readout Device for Your Microprocessor using his detailed design.
What's an I2L? Terry Steed has written a short background summary of this relatively new logic family, one which has important manufacturing and power consumption advantages which assure its place in the stable of semiconductor fabrication methods.
Many readers have found real bargains in older Baudot Teletype machines such as the Model 15 and the Model 19. The main problem, though, is Interfacing the 60 mA Current Loop to the normal TTL level signals of a typical microcomputer. One solution to this problem is provided by Walter S King's short article in this issue.
And for the cover, Robert Tinney portrays a scene from the near future.

=== Page 5 ===
In the Queue
AUGUST 1976 staff
Foreground
BUILD A TV READOUT DEVICE FOR YOUR MICROPROCESSOR
Hardware - Suding
TRUE CONFESSIONS: HOW I RELATE TO KIM
Hardware - Gupta
INTERFACING THE 60 mA CURRENT LOOP
Hardware - King
Background
WHAT DO YOU DO WITH A VIDEO DISK?
Speculation - Buchanan
FRIENDS, HUMANS, COUNTRY ROBOTS: LEND ME YOUR EARS
Hardware - Rice
THE TIME HAS COME TO TALK
Voice Systems - Atmar
MICROPROCESSOR UPDATE: ZILOG Z80
Hardware - Hashizume
MACHINE LANGUAGE PROGRAMMING FOR THE "8008" - Chapter 2
Software - Wadsworth
JACK AND THE MACHINE TALK (or, The Making of an Assembler)
Software - Grappel-Hemenway
WHAT'S AN I2L (I squared L)?
Hardware - Steed
BYTE magazine is published monthly by BYTE Publications, Inc., 70 Main St, Peterborough, New Hampshire 03458.

=== Page 6 ===
Some Notes on Clubs Mapping Sessions
On April 28, 1976 I attended one of the biweekly meetings of the Homebrew Computer Club in Palo Alto, CA with Dave Fylstra and Mike Wilbur of Stanford Research Institute as my guides. The meeting was most interesting from several points of view. One of the best features was the session of "mappings" which occupied the first portion of the evening's activity. This activity is one which would be well worth instituting by clubs elsewhere, so I'll describe my impressions.
The mapping session provides a mechanism for various members to advertise what they personally have to offer or what they are personally looking for. It is a way for the persons attending the meeting to find other persons with similar (or complementary) interests so that they can get together for exchanges of software, surplus components, expertise in fixing bugs, etc.
The key to the mapping session is a large set of people (in the Homebrew Computer Club, n=400) and an efficient "moderator" to coordinate the session.
TOWARD SPEECH INPUT?
Speech by computers is now quite possible and reduced to the form of output peripherals which can be commercially purchased. The problem of "pattern recognition" as applied to human speech inputs is a more difficult problem. For an excellent background tutorial on the subject of speech recognition, see an article by George M White of the Xerox Palo Alto Research Center, page 40 of the May 1976 IEEE Computer magazine.
Lee Felsenstein, the moderator, selects individuals who have raised hands to indicate they have an announcement. (The mechanism would obviously not work if everyone yelled at once.) Once recognized, the individual selected stands up, states his or her name, gives a short description of interests for the evening, then sits down.
The announcements people offer include fixes of hardware problems, special interest application areas, personal surplus hardware or parts, copies of personal software, etc.
For example, at the April 28 meeting, Tom Pittman, author of a Tiny BASIC for the 6800 processor, stood up and described the fact that he had it available with paper tape code and documentation in a package costing a nominal $5. (See page 76 of July. Continued on page 126

=== Page 7 ===
The Z-80 CPU by Zilog
From The Digital Group, of course.
If you are considering the purchase of an 8080-based system, look no further. The Z-80 has arrived. A new generation 8080 by the same individuals who helped design the original 8080 - combining all the advantages of the 6800, 6502 and 8080 into one fantastic little chip! And, the Z-80 maintains complete compatibility with 8080 software.
What's even better... the Z-80 is being brought to you by The Digital Group - people who understand quality and realize you expect the ultimate for your expenditure.
Take a look at some specifications:
Z-80 FEATURES
• Complete compatibility with 8080A object code • 80 new instructions for a total of 158
• 696 Op codes • Extensive 16-bit arithmetic • 3 Interrupt modes (incl 8080), mode 2 provides 128 interrupt vectors • Built-in automatic dynamic memory refresh • Eleven addressing modes
• New Instructions (highlights): Block move up to 64k bytes memory to memory, Block I/O up to 256 bytes to/from memory directly, String Search, Direct bit manipulation
• 22 Registers - 16 general purpose • 1, 4, 8 and 16 bit operations
DIGITAL GROUP Z-80 CPU CARD
• 2k bytes 500ns static RAM • 256 bytes EPROM bootstrap loader (1702A) • 2 Direct Memory Access (DMA) channels • Hardware Interrupt controller
• Data and Address bus lines drive 30 TTL loads • Z-80 runs at maximum rated speed
The Z-80 is here. And affordable. Prices for complete Digital Group systems with the Z-80 CPU start at $475. For more information, please call us or write now.
THE DIGITAL GROUP INC.
P.O. BOX 6528 DENVER, CO 80206 (303) 861-1686

=== Page 8 ===
What Do You Do With a Video Disk?
Martin Buchanan
2040 Lord Fairfax Rd Vienna VA 22180
In one to three years, for less than $1,000, you should be able to buy a mass storage system with the following characteristics:
Directly accessible in 10-50 ms. Data transmission rate of 15,000,000 bits per second. On line capacity of 4,000,000,000 bytes. Storage units costing $2 each.
The key to this technology is "videodisks." Several companies, here and abroad, have developed home videoplayers, all using disks as their recording medium. Two main types are in competition. RCA uses variations in capacitance to record information with an arm and head which track the grooves and pick up the signal. The RCA disks can only be accessed serially (sequentially); like a magnetic tape or audio cassette, to access a record you must pass over all the records between the desired record and your present position.
Philips and MCA Discovision have developed optical players which use a laser to scan the disk. Information is stored in "micropits" less than a micron in diameter which produce changes in the beam detected by photodiodes. These optical systems are direct access. The user can address any frame and access it quickly, regardless of the present position of the mechanism.
The new video disk technology will probably be "write only once" memory. But that won't matter much, for with essentially infinite storage (50¢ per billion bytes) you can store each new version of a program at a new physical location until the disk is full. Then you start a new disk.
Table 7a: Systems.
system access on line data rate access type capacity cost time
low speed audio cassette interface <$100 serial 25 - 540 bits/sec 110 - 600 seconds to minutes
Altair 88 DCDD disk kit $1480 direct 300 Kbytes 250,000 bits/sec 400 msec average
digidisk system -$1000 direct 4,000,000 Kbytes 15,000,000 bits/sec 30 msec average

=== Page 14 ===
Letters

COMPILER INPUTS NEEDED
Do you have space at the front of your Letters column for this request? [Yes.]
I'm writing a compiler for 8080 systems, and I'd like to know what everybody would like to have in it.
I'm personally leaning towards PL/I, which is my favorite language, but the compiler will be able to accept FORTRAN as well.
Would everybody take a moment to write me and tell me what they'd like to see in a new compiler?
I'll try to put in all the routines you can think of.
And please, don't be afraid to write simply because you think somebody else might, or you're too "new at the game."
Although I've been an IBM systems engineer, I also spent several years as a disc jockey in St Louis and Kansas City.
No matter who you are, your ideas need to be put into this compiler.
Peter Skye, Chief Engineer, Watermark Inc., 10700 Ventura Blvd, No Hollywood CA 91604, (213) 980-9490.
Let us know when it's ready.

EMULATION, ANYONE?
I just finished reading the literature on the new PCM-12 microcomputer which uses the Intersil IM6100 MPU that recognizes the Digital Equipment Corporation PDP-8 instruction set.
It occurs to me that a very worthwhile software development project for the home microcomputer system would be an interpretive translator/emulator program that would allow the microcomputer to run DEC's PDP-8 software (ie: program would input a single 12 bit PDP-8 instruction and then output one or more microcomputer 8 bit instructions which would be immediately executed and accomplish the same task).
This would allow the hobbyist to take advantage of the huge mountain of software developed for this very popular minicomputer, which includes such high level languages as BASIC, FORTRAN, ALGOL, FOCAL, etc.
Most of the software is available over the counter from DEC for a very nominal charge.
Because the architecture of the PDP-8 is based on a 12 bit word, the 8 bit microcomputer would have to operate on each word as two 6 bit half words stored in consecutive locations.
The main disadvantage with this emulator method would lie in the increased memory length and execution time required.
I would like to see some dialogue started in the pages of BYTE on the desirability and feasibility of a program such as this.
Some prime candidates for translators would be microcomputer systems based on the 8080, M6800, and MCS6500 (especially the latter since no high level languages exist for this unit, but a number of very low cost systems are available).
Don B Keek Jr, Senior Engineer, Loudspeakers, ElectroVoice Inc, 600 Cecil St, Buchanan MI 49107.

CRITIQUE AND SUGGESTIONS
Your article in the March BYTE "Assembling Programs by Hand" [page 52] was very pertinent and timely.
It's probably the method most of your readers will be using.
The actual "how to do it" part was well done and allowed rather complete comprehension by most of your readers.
The first part of the article setting up the example to work on was probably beyond most of your readers, at least those who did not come up through programming.
Either a simpler example or more explanation of the example used would have made the article even more valuable.
We see much written on interfacing to peripherals such as TTY, TV keyboards, tape cassettes, etc, which of course is needed.
But isn't it time to start going into some of the other functions a growing number of personal computers are capable of performing?

=== Page 123 ===
COMPLETE ALARM CLOCK
4 Digits 0.5" LED with brightness control. 12 Hour display with AM/PM indication. True 24 hour alarm with repeatable snooze. Power failure indication for power interrupt.
MODEL EC 400 (Not A Kit) Only $22.50.

NEW CLOCK KITS!
MODEL OC1032 JUMBO DIGITS ALARM CLOCK 1.2" Bright Yellow Color Readouts.
Features: 12/24 Hour Display, 24 Hour Alarm Set, 10 Min Snooze Switch, AM/PM Indicator.
Kit Includes: Woodlike Color Plastic Case, 4 Digit 1.2" Neon Display with AM/PM, TMS 3834 Alarm Chip, 2 pcs double sided PC Boards, 16 transistors, all other components, Transformer and speaker.
SPECIAL $35.90.

MODEL OC1030 4 DIGIT ALARM CLOCK KIT 0.5" Green Color Readouts.
Features: 12/24 Hour Displays, 24 Hour Alarm Set, 10 Min Snooze Switch, AM/PM Display.
Kit Includes: Orange Color Plastic Case, 0.5" LD8132 Green Color Readouts PC boards with transformer, all electronic parts with speaker.
Only $28.50.

THE MOST POPULAR MM5314 KIT
WITH A NEW CASE!! Features: 12/24 Hour Display 50/60 HZ Input 6 Digits Readout. Kit Includes: Grey Color Plastic Case MM5314 Clock Chip PC Boards and Transformer, 6 Green Color 0.3" Tube Readouts, All other transistor Drivers and other Components.
Special Only $19.95 ea.

MODEL CT7001
Drive 6 Fairchild FND 0.5" Red LED with MONTH & DATE 50/60HZ AND ALARM.
(without case) Only $28.50 ea.

CLOCK CHIPS & IC SOCKETS
MM 5311 24 pin 6 digits MUX and BCD output $4.50 each.
MM 5313 28 pin 6 digit MUX output $4.00 each.
MM 5314 24 pin 6 digits MUX output $3.50 each.
CT 7001 28 pin Alarm Time & Date $6.50 each.
MM 5316 (F3817) 40 pin Alarm, Direct Drive LED $4.50 each.
GOLD WIRE WRAP IC SOCKETS: 14 pin .36 each (10 for $3.00), 16 pin .50 each (10 for 4.00), 24 pin 1.25 each (10 for 10.00), 28 pin 1.25 each (10 for 10.00).
SOLDER TAIL SOCKETS: 14 pin .35 each (10 for 2.80), 16 pin .36 each (10 for 3.00), 18 pin .40 each (10 for 3.50), 24 pin 1.00 each (10 for 8.00), 28 pin 1.10 each (10 for 9.00), 40 pin 1.25 (10 for 10.00).

ELECTRONIC KITS, SWITCHES & KEYBOARDS
ELECTRONIC SWITCH KIT: CONDENSER TYPE. Touch On Touch Off use 7473 I.C. and 6V relay. $5.50 each.
FM WIRELESS MIC KIT: Transmit range up to 500ft. Easy to assemble $4.50 each.
ELECTRONIC ORGAN KEYBOARD: 3 Octaves Full Size Limited Quantity $33.00 each.
12 VDC RELAY SPDT 4 amp $1.25 ea.
6V 6AMPH YUASA Wet Rechargeable Battery BRAND NEW $7.50 ea.
AUTO ALARM KIT: The Crimefighter Auto Alarm is an electronic, self controlled auto protection system. Only $10.00 per kit Completed Unit $16.00.
COMPUTER KEYBOARDS: Standard Teletype Keyboards with gold plated contact switches. All switches are independent and allow you to connect into any form of output. Only $22.50.
MODEL B SPECIAL ONLY $16.50 ea. Fully ASCII decoded with electronic parts TTL logic. Used but all in good condition.

ORDER TERMS & STORE ADDRESS
MINIMUM ORDER $10.00. California residents add 6% sales and 1.50 to cover postage and handling. Out-of-state and overseas countries add $2.50.
SEND CHECK OR MONEY ORDER TO:
FORMULA INTERNATIONAL INC.
12603 CRENSHAW BOULEVARD • HAWTHORNE, CALIFORNIA 90250
For more information please call (213) 679-5162
STORE HOURS 10-7 Monday - Saturday · 8/76

=== Page 126 ===
Clubs and Newsletters
Continued from page 6
In the previous section, we discussed the Homebrew Computer Club mapping sessions.
Once the announcements are made, people break into interest groups: 8080 users, 6800 enthusiasts, hardware interfacing, and video displays.
The club mapping session proves that hobbyist computing thrives on direct peer-to-peer exchange of knowledge, homebrew software, and surplus components.
For further details on mapping sessions, write to Homebrew Computer Club, P.O. Box 626, Mountain View CA 94042.
`;

/**
 * Generate synthetic SVG render for a sample page to give an authentic 1976 BYTE magazine look.
 */
function createSamplePageImageSvg(pageNumber: number, title: string, isAd: boolean, paragraphs: string[]): string {
  const width = 800;
  const height = 1100;
  const bg = isAd ? '#fffdf0' : '#faf8f5';
  const border = isAd ? '#fef08a' : '#e2e8f0';

  // Format paragraphs into clean HTML for foreignObject
  const formattedHtml = paragraphs.map((para, i) => {
    const isHeading = i === 0 || (para.length < 50 && para === para.toUpperCase());
    const isCoupon = para.includes('NAME _______') || para.includes('Send the following');
    const isTable = para.startsWith('system access') || para.includes('Kbytes');

    if (isHeading) {
      return `<h3 style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 17px; font-weight: 800; color: #0f172a; margin: 12px 0 6px 0; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;">${escapeHtml(para)}</h3>`;
    }
    if (isCoupon) {
      return `<div style="border: 2px dashed #94a3b8; background: #fff; padding: 10px; margin: 12px 0; font-family: monospace; font-size: 11px; line-height: 1.4; color: #0f172a;">${escapeHtml(para).replace(/\n/g, '<br/>')}</div>`;
    }
    if (isTable) {
      return `<div style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px; margin: 10px 0; font-family: monospace; font-size: 11px; white-space: pre-wrap; color: #1e293b;">${escapeHtml(para)}</div>`;
    }
    return `<p style="margin: 0 0 10px 0; font-family: 'Georgia', serif; font-size: 13.5px; line-height: 1.55; color: #1e293b; text-align: justify;">${escapeHtml(para)}</p>`;
  }).join('');

  // Retro cover art style for Page 1
  const isCover = pageNumber === 1;
  const isFormulaAd = pageNumber === 123;
  const isLetters = pageNumber === 14;

  if (isFormulaAd) {
    const adSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#ffffff" stroke="#000000" stroke-width="12"/>
      <!-- Sawtooth / Zig-zag Vintage Border Motif -->
      <path d="M 12 12 L 788 12 L 788 1088 L 12 1088 Z" fill="none" stroke="#000" stroke-width="3" stroke-dasharray="8,8"/>

      <!-- Header Top Section: 3-column banner -->
      <!-- Box 1: Alarm Clock -->
      <rect x="25" y="25" width="245" height="155" fill="#f8fafc" stroke="#000" stroke-width="2"/>
      <rect x="25" y="25" width="245" height="24" fill="#000"/>
      <text x="147" y="42" font-family="'Arial Black', sans-serif" font-size="12" fill="#fff" text-anchor="middle">COMPLETE ALARM CLOCK</text>
      <text x="35" y="66" font-family="monospace" font-size="10" fill="#111">• 4 Digits 0.5" LED brightness</text>
      <text x="35" y="80" font-family="monospace" font-size="10" fill="#111">• 12 Hr display AM/PM</text>
      <text x="35" y="94" font-family="monospace" font-size="10" fill="#111">• True 24 hr repeatable snooze</text>
      <rect x="135" y="115" width="125" height="28" fill="#111" rx="2"/>
      <text x="197" y="134" font-family="'Arial Black', sans-serif" font-size="13" font-weight="bold" fill="#fff" text-anchor="middle">Only $22.50</text>

      <!-- Box 2: Clock Chips -->
      <rect x="278" y="25" width="245" height="155" fill="#ffffff" stroke="#000" stroke-width="2"/>
      <rect x="278" y="25" width="245" height="24" fill="#000"/>
      <text x="400" y="42" font-family="'Arial Black', sans-serif" font-size="12" fill="#fff" text-anchor="middle">CLOCK CHIPS</text>
      <text x="288" y="66" font-family="monospace" font-size="9.5" fill="#111">MM 5311  24 pin 6 digits  $4.50</text>
      <text x="288" y="80" font-family="monospace" font-size="9.5" fill="#111">MM 5313  28 pin 6 digit   $4.00</text>
      <text x="288" y="94" font-family="monospace" font-size="9.5" fill="#111">MM 5314  24 pin 6 digits  $3.50</text>
      <text x="288" y="108" font-family="monospace" font-size="9.5" fill="#111">CT 7001  28 pin Time/Date $6.50</text>
      <text x="288" y="122" font-family="monospace" font-size="9.5" fill="#111">MM 5316  40 pin Alarm LED $4.50</text>

      <!-- Box 3: Electronic Switch Kit -->
      <rect x="530" y="25" width="245" height="155" fill="#f8fafc" stroke="#000" stroke-width="2"/>
      <rect x="530" y="25" width="245" height="24" fill="#000"/>
      <text x="652" y="42" font-family="'Arial Black', sans-serif" font-size="12" fill="#fff" text-anchor="middle">ELECTRONIC SWITCH KIT</text>
      <text x="540" y="66" font-family="monospace" font-size="10" fill="#111">CONDENSER TYPE</text>
      <text x="540" y="80" font-family="monospace" font-size="9.5" fill="#111">Touch On / Touch Off</text>
      <text x="540" y="94" font-family="monospace" font-size="9.5" fill="#111">use 7473 IC &amp; 6V relay</text>
      <text x="652" y="132" font-family="'Arial Black', sans-serif" font-size="13" fill="#000" text-anchor="middle">$5.50 each</text>

      <!-- Middle Tier 1: Clock Kits & Sockets -->
      <rect x="25" y="190" width="245" height="175" fill="#ffffff" stroke="#000" stroke-width="2"/>
      <rect x="25" y="190" width="245" height="22" fill="#000"/>
      <text x="147" y="206" font-family="'Arial Black', sans-serif" font-size="11" fill="#fff" text-anchor="middle">NEW CLOCK KITS!</text>
      <text x="35" y="228" font-family="sans-serif" font-size="10" font-weight="bold" fill="#000">MODEL OC1032 JUMBO 1.2"</text>
      <text x="35" y="244" font-family="monospace" font-size="9" fill="#333">Bright Yellow Color Readouts</text>
      <text x="35" y="260" font-family="monospace" font-size="9" fill="#333">12/24 Hr, 10 Min Snooze</text>
      <rect x="35" y="275" width="225" height="24" fill="#000"/>
      <text x="147" y="291" font-family="'Arial Black', sans-serif" font-size="12" fill="#fff" text-anchor="middle">SPECIAL $35.90</text>
      <text x="35" y="320" font-family="sans-serif" font-size="10" font-weight="bold" fill="#000">MODEL OC1030 4 DIGIT</text>
      <text x="35" y="334" font-family="monospace" font-size="9" fill="#333">0.5" Green Readouts: $28.50</text>

      <!-- Sockets in Center -->
      <rect x="278" y="190" width="245" height="175" fill="#f8fafc" stroke="#000" stroke-width="2"/>
      <text x="400" y="210" font-family="'Arial Black', sans-serif" font-size="10" fill="#000" text-anchor="middle">WIRE WRAP &amp; SOLDER SOCKETS</text>
      <line x1="285" y1="216" x2="515" y2="216" stroke="#000" stroke-width="1"/>
      <text x="288" y="234" font-family="monospace" font-size="9" fill="#111">14 pin WW  .36 ea (10/$3.00)</text>
      <text x="288" y="248" font-family="monospace" font-size="9" fill="#111">16 pin WW  .50 ea (10/$4.00)</text>
      <text x="288" y="262" font-family="monospace" font-size="9" fill="#111">24 pin WW 1.25 ea (10/$10.00)</text>
      <text x="288" y="280" font-family="monospace" font-size="9" fill="#111">14 pin ST  .35 ea (10/$2.80)</text>
      <text x="288" y="294" font-family="monospace" font-size="9" fill="#111">16 pin ST  .36 ea (10/$3.00)</text>
      <text x="288" y="308" font-family="monospace" font-size="9" fill="#111">24 pin ST 1.00 ea (10/$8.00)</text>
      <text x="288" y="322" font-family="monospace" font-size="9" fill="#111">40 pin ST 1.25 ea (10/$10.00)</text>
      <text x="288" y="338" font-family="monospace" font-size="9" fill="#111">Xtal Socket .35 each</text>

      <!-- Right Column: Organ Keyboard & Wireless Mic -->
      <rect x="530" y="190" width="245" height="175" fill="#ffffff" stroke="#000" stroke-width="2"/>
      <text x="652" y="210" font-family="'Arial Black', sans-serif" font-size="11" fill="#000" text-anchor="middle">ELECTRONIC ORGAN KEYBOARD</text>
      <line x1="535" y1="216" x2="770" y2="216" stroke="#000" stroke-width="1"/>
      <!-- Keyboard Keys Art -->
      <rect x="550" y="224" width="205" height="40" fill="#fff" stroke="#000" stroke-width="1.5"/>
      <line x1="565" y1="224" x2="565" y2="264" stroke="#000"/>
      <line x1="580" y1="224" x2="580" y2="264" stroke="#000"/>
      <line x1="595" y1="224" x2="595" y2="264" stroke="#000"/>
      <line x1="610" y1="224" x2="610" y2="264" stroke="#000"/>
      <line x1="625" y1="224" x2="625" y2="264" stroke="#000"/>
      <line x1="640" y1="224" x2="640" y2="264" stroke="#000"/>
      <line x1="655" y1="224" x2="655" y2="264" stroke="#000"/>
      <line x1="670" y1="224" x2="670" y2="264" stroke="#000"/>
      <line x1="685" y1="224" x2="685" y2="264" stroke="#000"/>
      <line x1="700" y1="224" x2="700" y2="264" stroke="#000"/>
      <line x1="715" y1="224" x2="715" y2="264" stroke="#000"/>
      <line x1="730" y1="224" x2="730" y2="264" stroke="#000"/>
      <rect x="558" y="224" width="8" height="24" fill="#000"/>
      <rect x="573" y="224" width="8" height="24" fill="#000"/>
      <rect x="603" y="224" width="8" height="24" fill="#000"/>
      <rect x="618" y="224" width="8" height="24" fill="#000"/>
      <rect x="633" y="224" width="8" height="24" fill="#000"/>
      <rect x="663" y="224" width="8" height="24" fill="#000"/>
      <rect x="678" y="224" width="8" height="24" fill="#000"/>
      <rect x="708" y="224" width="8" height="24" fill="#000"/>
      <rect x="723" y="224" width="8" height="24" fill="#000"/>
      <text x="652" y="280" font-family="sans-serif" font-size="9.5" fill="#111" text-anchor="middle">3 Octaves Full Size · Limited Quantity</text>
      <text x="652" y="300" font-family="'Arial Black', sans-serif" font-size="14" fill="#000" text-anchor="middle">$33.00 each</text>
      <text x="652" y="324" font-family="sans-serif" font-size="9.5" fill="#111" text-anchor="middle">FM WIRELESS MIC KIT $4.50</text>
      <text x="652" y="340" font-family="sans-serif" font-size="9" fill="#555" text-anchor="middle">Range up to 500ft · Easy assemble</text>

      <!-- Middle Tier 2: Popular MM5314 Kit & Teletype Keyboards -->
      <rect x="25" y="375" width="245" height="185" fill="#f8fafc" stroke="#000" stroke-width="2"/>
      <rect x="25" y="375" width="245" height="22" fill="#000"/>
      <text x="147" y="391" font-family="'Arial Black', sans-serif" font-size="11" fill="#fff" text-anchor="middle">THE MOST POPULAR MM5314 KIT</text>
      <text x="35" y="415" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#000">WITH A NEW CASE!!</text>
      <text x="35" y="430" font-family="monospace" font-size="9" fill="#222">12/24 Hr Display · 50/60 Hz</text>
      <text x="35" y="444" font-family="monospace" font-size="9" fill="#222">6 Green 0.3" Tube Readouts</text>
      <rect x="35" y="460" width="225" height="24" fill="#000"/>
      <text x="147" y="476" font-family="'Arial Black', sans-serif" font-size="11" fill="#fff" text-anchor="middle">Special Only $19.95 ea.</text>
      <text x="35" y="506" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#000">MODEL CT7001 (without case)</text>
      <text x="35" y="520" font-family="monospace" font-size="9" fill="#222">Month &amp; Date · Only $28.50 ea.</text>

      <!-- Center Components Matrix -->
      <rect x="278" y="375" width="245" height="185" fill="#ffffff" stroke="#000" stroke-width="2"/>
      <text x="400" y="395" font-family="'Arial Black', sans-serif" font-size="10" fill="#000" text-anchor="middle">COMPONENTS &amp; ACCESSORIES</text>
      <line x1="285" y1="400" x2="515" y2="400" stroke="#000"/>
      <text x="288" y="418" font-family="monospace" font-size="9" fill="#111">12 VDC RELAY SPDT 4A  $1.25</text>
      <text x="288" y="434" font-family="monospace" font-size="9" fill="#111">6V 6AH YUASA BATTERY  $7.50</text>
      <text x="288" y="450" font-family="monospace" font-size="9" fill="#111">AC ADAPTERS (Multi)   $2.85</text>
      <text x="288" y="466" font-family="monospace" font-size="9" fill="#111">TRANSFORMERS 12V CT   $1.50</text>
      <text x="288" y="482" font-family="monospace" font-size="9" fill="#111">NI-CD AA SANYO 4/$6   $1.60</text>
      <text x="288" y="498" font-family="monospace" font-size="9" fill="#111">AUTO ALARM KIT       $10.00</text>
      <text x="288" y="514" font-family="monospace" font-size="9" fill="#111">50 UA PANEL METER     $3.80</text>
      <text x="288" y="530" font-family="monospace" font-size="9" fill="#111">CAPACITOR 15500uF 75V $4.95</text>

      <!-- Right Column: Memories & Switches -->
      <rect x="530" y="375" width="245" height="185" fill="#f8fafc" stroke="#000" stroke-width="2"/>
      <text x="652" y="395" font-family="'Arial Black', sans-serif" font-size="10" fill="#000" text-anchor="middle">SEMICONDUCTOR MEMORIES</text>
      <line x1="535" y1="400" x2="770" y2="400" stroke="#000"/>
      <text x="540" y="418" font-family="monospace" font-size="9" fill="#111">1702A Erasable PROM  $13.50</text>
      <text x="540" y="434" font-family="monospace" font-size="9" fill="#111">2102-1 1K Static RAM  $2.25</text>
      <text x="540" y="450" font-family="monospace" font-size="9" fill="#111"> (Over 10 pcs: $1.99 ea)</text>
      <text x="540" y="466" font-family="monospace" font-size="9" fill="#111">2107A 4K Dynamic RAM  $4.50</text>
      <text x="540" y="482" font-family="monospace" font-size="9" fill="#111">4096 Bit Intel Prime $16.50</text>
      <text x="540" y="504" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#000">SWITCHES &amp; CRYSTALS</text>
      <text x="540" y="520" font-family="monospace" font-size="9" fill="#111">DIP 4/8 Toggle, Thumbwheel</text>
      <text x="540" y="534" font-family="monospace" font-size="9" fill="#111">1MHz, 3.58MHz Crystals $1.25</text>

      <!-- Big Bottom Left: Computer Keyboards -->
      <rect x="25" y="570" width="750" height="230" fill="#ffffff" stroke="#000" stroke-width="2"/>
      <rect x="25" y="570" width="750" height="26" fill="#000"/>
      <text x="400" y="588" font-family="'Arial Black', sans-serif" font-size="13" fill="#fff" text-anchor="middle">COMPUTER KEYBOARDS · TELETYPE WITH GOLD PLATED CONTACTS</text>
      <text x="45" y="620" font-family="sans-serif" font-size="11" font-weight="bold" fill="#000">Standard Teletype Keyboards with gold plated contact switches.</text>
      <text x="45" y="638" font-family="sans-serif" font-size="10.5" fill="#222">All switches are independent and allow you to connect into any form of output.</text>
      <rect x="45" y="650" width="180" height="30" fill="#000" rx="2"/>
      <text x="135" y="670" font-family="'Arial Black', sans-serif" font-size="14" fill="#fff" text-anchor="middle">Only $22.50</text>
      <text x="45" y="705" font-family="sans-serif" font-size="11" font-weight="bold" fill="#000">MODEL B SPECIAL ONLY $16.50 ea.</text>
      <text x="45" y="722" font-family="sans-serif" font-size="10.5" fill="#222">Fully ASCII decoded with electronic parts TTL logic. Used but all in good condition.</text>

      <!-- Order Terms Section -->
      <rect x="25" y="810" width="750" height="75" fill="#f1f5f9" stroke="#000" stroke-width="2"/>
      <text x="400" y="832" font-family="'Arial Black', sans-serif" font-size="11" fill="#000" text-anchor="middle">MINIMUM ORDER $10.00</text>
      <text x="400" y="850" font-family="sans-serif" font-size="10" fill="#222" text-anchor="middle">California residents add 6% sales and 1.50 to cover postage and handling. Out-of-state and overseas countries add $2.50.</text>
      <text x="400" y="868" font-family="sans-serif" font-size="10" font-weight="bold" fill="#000" text-anchor="middle">SEND CHECK OR MONEY ORDER TO FORMULA INTERNATIONAL INC.</text>

      <!-- Big Bottom Masthead / Footer (Matching Page 123) -->
      <rect x="25" y="895" width="750" height="150" fill="#ffffff" stroke="#000" stroke-width="3"/>
      <!-- Vintage Optical Logo Circle -->
      <circle cx="120" cy="965" r="42" fill="none" stroke="#000" stroke-width="8"/>
      <circle cx="120" cy="965" r="24" fill="none" stroke="#000" stroke-width="6"/>
      <circle cx="120" cy="965" r="8" fill="#000"/>

      <text x="180" y="960" font-family="'Impact', 'Arial Black', sans-serif" font-size="34" letter-spacing="2" fill="#000">FORMULA INTERNATIONAL INC.</text>
      <text x="180" y="985" font-family="'Helvetica Neue', Arial, sans-serif" font-size="12" font-weight="bold" fill="#222">12603 CRENSHAW BOULEVARD • HAWTHORNE, CALIFORNIA 90250</text>
      <text x="180" y="1005" font-family="'Helvetica Neue', Arial, sans-serif" font-size="11" fill="#444">For more information please call (213) 679-5162 · STORE HOURS 10-7 Monday - Saturday</text>
      <text x="750" y="1025" font-family="monospace" font-size="12" font-weight="bold" fill="#000" text-anchor="end">8/76 · Page 123</text>
    </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(adSvg)}`;
  }

  if (isLetters) {
    const lettersSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#faf8f5" stroke="#e2e8f0" stroke-width="3"/>
      <!-- Header Masthead -->
      <rect x="40" y="25" width="720" height="42" fill="#1e293b" rx="4"/>
      <text x="58" y="52" font-family="'Arial Black', Impact, sans-serif" font-size="20" font-weight="900" fill="#f8fafc">BYTE</text>
      <text x="125" y="52" font-family="'Georgia', serif" font-style="italic" font-size="12" fill="#cbd5e1">the small systems journal</text>
      <text x="740" y="52" font-family="sans-serif" font-size="11" fill="#94a3b8" text-anchor="end">AUGUST 1976 · PAGE 14</text>

      <!-- Huge Letters Title -->
      <text x="50" y="135" font-family="'Playfair Display', Georgia, serif" font-size="42" font-weight="bold" fill="#0f172a">Letters</text>

      <!-- Cartoon illustration in top center-right (matching Python screenshot) -->
      <rect x="320" y="80" width="220" height="120" fill="#f1f5f9" stroke="#475569" stroke-width="2"/>
      <rect x="340" y="95" width="60" height="50" fill="#0f172a" rx="4"/>
      <text x="370" y="125" font-family="monospace" font-size="8" fill="#38bdf8" text-anchor="middle">&gt;8080_</text>
      <circle cx="460" cy="120" r="22" fill="#e2e8f0" stroke="#334155" stroke-width="2"/>
      <text x="460" y="124" font-family="sans-serif" font-size="9" fill="#334155" text-anchor="middle">Hobbyist</text>
      <text x="430" y="185" font-family="sans-serif" font-size="9" font-style="italic" fill="#64748b" text-anchor="middle">"What would you like in an 8080 compiler?"</text>

      <!-- Editorial Quote Callout on Left Column -->
      <rect x="45" y="230" width="160" height="150" fill="#fff" stroke="#cbd5e1" stroke-width="1" rx="4"/>
      <text x="55" y="255" font-family="Georgia, serif" font-size="11" font-style="italic" fill="#475569">
        <tspan x="55" dy="0">"Very soon the interest</tspan>
        <tspan x="55" dy="16">is going to shift from</tspan>
        <tspan x="55" dy="16">'what to buy' and</tspan>
        <tspan x="55" dy="16">'how to get it going'</tspan>
        <tspan x="55" dy="16">over to 'what to do</tspan>
        <tspan x="55" dy="16">with it.'"</tspan>
      </text>

      <!-- 2-Column Text Flow for Letters Content -->
      <foreignObject x="220" y="220" width="540" height="830">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Georgia, serif; font-size: 13px; line-height: 1.55; color: #1e293b; overflow: hidden; height: 100%;">
          ${formattedHtml}
        </div>
      </foreignObject>

      <line x1="50" y1="1065" x2="750" y2="1065" stroke="#cbd5e1" stroke-width="1"/>
      <text x="50" y="1082" font-family="sans-serif" font-size="10" fill="#64748b">1976 BYTE Publications Inc. · Letters Column</text>
      <text x="740" y="1082" font-family="sans-serif" font-size="10" font-weight="bold" fill="#334155" text-anchor="end">Page 14</text>
    </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(lettersSvg)}`;
  }

  const coverSvg = isCover ? `
    <rect x="70" y="240" width="660" height="420" fill="#0f172a" rx="8"/>
    <!-- Simulated CRT Oscilloscope / Waveform Art -->
    <path d="M 100 450 Q 180 320, 260 450 T 420 450 T 580 450 T 700 450" fill="none" stroke="#38bdf8" stroke-width="4"/>
    <path d="M 100 450 Q 140 280, 220 450 T 360 450 T 500 450 T 700 450" fill="none" stroke="#f59e0b" stroke-width="3" opacity="0.8"/>
    <circle cx="400" cy="450" r="110" fill="none" stroke="#e2e8f0" stroke-width="1.5" stroke-dasharray="4,4"/>
    <text x="400" y="380" font-family="'Courier New', monospace" font-size="14" fill="#38bdf8" text-anchor="middle" font-weight="bold">VOICE TRACT SIMULATOR</text>
    <text x="400" y="520" font-family="'Courier New', monospace" font-size="12" fill="#94a3b8" text-anchor="middle">FORMANT FREQUENCY GENERATOR</text>
  ` : '';

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <style>
        .page-text { font-family: 'Georgia', serif; font-size: 13.5px; line-height: 1.55; color: #1e293b; }
      </style>
    </defs>
    <rect width="100%" height="100%" fill="${bg}" stroke="${border}" stroke-width="3"/>

    <!-- Vintage Header Masthead -->
    <rect x="40" y="25" width="720" height="48" fill="#1e293b" rx="4"/>
    <text x="58" y="55" font-family="'Arial Black', Impact, sans-serif" font-size="22" font-weight="900" fill="#f8fafc" letter-spacing="1">BYTE</text>
    <text x="135" y="55" font-family="'Georgia', serif" font-style="italic" font-size="13" fill="#cbd5e1">the small systems journal</text>
    <text x="580" y="46" font-family="sans-serif" font-size="11" fill="#94a3b8">AUGUST 1976 · ISSUE 12</text>
    <text x="580" y="62" font-family="sans-serif" font-size="11" font-weight="bold" fill="#f59e0b">PAGE ${pageNumber} of 132</text>

    ${isAd ? `
      <rect x="520" y="80" width="240" height="26" fill="#f59e0b" rx="3"/>
      <text x="640" y="97" font-family="sans-serif" font-size="11" font-weight="bold" fill="#000000" text-anchor="middle">★ VINTAGE ADVERTISEMENT ★</text>
    ` : ''}

    <!-- Page Title Headline -->
    <text x="50" y="${isCover ? '120' : '105'}" font-family="'Helvetica Neue', Arial, sans-serif" font-size="${isCover ? '28' : '20'}" font-weight="bold" fill="#0f172a">${escapeHtml(title)}</text>
    <line x1="50" y1="${isCover ? '135' : '118'}" x2="750" y2="${isCover ? '135' : '118'}" stroke="#94a3b8" stroke-width="1.5"/>

    ${coverSvg}

    <!-- Embedded High-Fidelity Typeset Article Content -->
    <foreignObject x="50" y="${isCover ? '680' : '130'}" width="700" height="${isCover ? '380' : '930'}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Georgia, serif; font-size: 13.5px; line-height: 1.55; color: #1e293b; overflow: hidden; height: 100%;">
        ${formattedHtml}
      </div>
    </foreignObject>

    <!-- Page Footer Folio -->
    <line x1="50" y1="1065" x2="750" y2="1065" stroke="#cbd5e1" stroke-width="1"/>
    <text x="50" y="1082" font-family="sans-serif" font-size="10" fill="#64748b">1976 BYTE Publications Inc. · Speech Synthesis &amp; Personal Computing</text>
    <text x="740" y="1082" font-family="sans-serif" font-size="10" font-weight="bold" fill="#334155" text-anchor="end">Page ${pageNumber}</text>
  </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Parses the sample magazine dump into a full PageUnit array with calibrated reading bboxes
 */
export function getSampleMagazinePages(): PageUnit[] {
  const pageSections = SAMPLE_OCR_TEXT.split(/=== Page (\d+) ===/g);
  const pages: PageUnit[] = [];

  for (let i = 1; i < pageSections.length; i += 2) {
    const pageNum = parseInt(pageSections[i], 10);
    const rawContent = (pageSections[i + 1] || '').trim();
    if (!rawContent) continue;

    const rawParagraphs = rawContent
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean);

    const pageW = 800;
    const pageH = 1100;
    const isCover = pageNum === 1;
    const topStart = isCover ? 680 : 135;
    const availableHeight = isCover ? 370 : 920;
    const totalParas = Math.max(1, rawParagraphs.length);
    const paraHeight = Math.min(180, Math.max(45, (availableHeight - (totalParas * 12)) / totalParas));

    // Generate coordinate-mapped lines / chunks matching layout
    let lines: OcrLine[];

    if (pageNum === 123) {
      // Precise bboxes matching Formula International ad boxes from page_123.jpg
      const adBoxes = [
        { left: 25, top: 25, width: 245, height: 155 },
        { left: 25, top: 190, width: 245, height: 175 },
        { left: 25, top: 375, width: 245, height: 185 },
        { left: 278, top: 25, width: 245, height: 160 },
        { left: 278, top: 190, width: 245, height: 175 },
        { left: 278, top: 375, width: 245, height: 185 },
        { left: 530, top: 25, width: 245, height: 160 },
        { left: 530, top: 190, width: 245, height: 175 },
        { left: 530, top: 375, width: 245, height: 185 },
        { left: 25, top: 570, width: 750, height: 230 },
        { left: 25, top: 810, width: 750, height: 75 },
        { left: 25, top: 895, width: 750, height: 150 },
      ];

      lines = rawParagraphs.map((text, idx) => {
        const box = adBoxes[idx % adBoxes.length];
        return {
          text,
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          confidence: 97,
        };
      });
    } else if (pageNum === 14) {
      // Letters column layout (right side 2-column flow matching screenshot)
      lines = rawParagraphs.map((text, idx) => {
        const isHeading = idx === 0 || text === 'Letters' || text.startsWith('COMPILER') || text.startsWith('EMULATION') || text.startsWith('CRITIQUE');
        const top = 220 + idx * 72;
        return {
          text,
          left: 220,
          top,
          width: 540,
          height: isHeading ? 32 : 64,
          confidence: 98,
        };
      });
    } else {
      lines = rawParagraphs.map((text, idx) => {
        const top = topStart + idx * (paraHeight + 12);
        const isHeading = idx === 0 || (text.length < 45 && text === text.toUpperCase());
        const height = isHeading ? 36 : paraHeight;
        const width = 700;
        const left = 50;

        return {
          text,
          left,
          top,
          width,
          height,
          confidence: 96,
        };
      });
    }

    const chunks = mergeLinesToChunks(lines, 500);
    const contOn = parseContinuedOn(rawContent);
    const contFrom = parseContinuedFrom(rawContent);

    const dummyPage: PageUnit = {
      pageNumber: pageNum,
      label: `Page ${pageNum}`,
      width: pageW,
      height: pageH,
      lines,
      chunks: chunks.length > 0 ? chunks : lines,
      rawText: rawContent,
      isProofread: false,
      skipAsAd: false,
      adReasons: [],
      inferredTitle: '',
      continuedOn: contOn,
      continuedFrom: contFrom,
    };

    const adEval = looksLikeAd(dummyPage);
    dummyPage.skipAsAd = adEval.isAd;
    dummyPage.adReasons = adEval.reasons;
    dummyPage.inferredTitle = inferPageTitle(dummyPage, `Page ${pageNum}`);
    dummyPage.image = createSamplePageImageSvg(pageNum, dummyPage.inferredTitle, dummyPage.skipAsAd, rawParagraphs);

    pages.push(dummyPage);
  }

  return pages;
}

