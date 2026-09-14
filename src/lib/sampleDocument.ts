import { PageUnit, OcrLine } from '../types';
import { mergeLinesToChunks } from './layoutAndColumns';
import { parseContinuedFrom, parseContinuedOn } from './continueLinks';
import { looksLikeAd } from './adDetection';
import { inferPageTitle } from './articleExport';
import { tagPagesHeaderFooters } from './headerFooterDetection';

// Real text and editorial content from 1976_08_BYTE_00-12_Speech_Synthesis.pdf
const SAMPLE_OCR_TEXT = `=== Page 1 ===
BYTE: the small systems journal. August 1976, Issue 12.
SPEECH SYNTHESIS BY COMPUTER.
Featured in this issue: What Do You Do With a Video Disk? Microprocessor Update: The Zilog Z80. Build a TV Readout Device for Your Microprocessor.
Robert Tinney Cover Art · Printed in USA · Price: $1.50.

=== Page 2 ===
NEED HARDCOPY?
If you are one of the many computer users who wants hardcopy printouts, but can't afford any of the available machines, your troubles are over. Our PR-40 is a universal printer that gives you clear easy to read hardcopy like the sample on the right with almost any computer. Our printer operates from any eight bit parallel I/O port. The printer has it's own character generator and memory buffer. This means that the computers only job is to feed data when the printer is ready.
No special program is needed in the computer to convert the data to a form that the printer can use as each character is printed. The PR-40 is easy to use, easy to interface and easy to afford.
* SWTPC PR-40 ALPHANUMERIC PRINTER *
40 CHARACTERS / LINE * 5 x 7 DOT MATRIX DISPLAY * USES STANDARD 3 7/8" CALCULATOR PAPER
75 LINES PER MINUTE * AUTOMATIC RIBBON REVERSE * 64 CHARACTER ASCII CHARACTER SET
40 CHARACTER LINE BUFFER * TTL, SWTPC 6800, MITS COMPATIBLE
PR-40 LINE PRINTER KIT ... $250.00 PPd
HOW ABOUT PICTURES?
Games are more fun with pictures. Now you can add graphics displays to your game programs and on any type computer. Our GT-6144 operates from any eight bit parallel I/O port. It has it's own self contained memory, so memory space for the display is not robbed from your computer. The 9 1/2 x 13 circuit board contains all you need to produce a graphic display like the one of the starship "Enterprise" shown on the left. Kit is less power supply, or chassis.
GT-6144 GRAPHICS TERMINAL KIT .. $ 98.50 PPd
I know a bargain when I see it. Send the following:
NAME ____________________ ADDRESS ____________________ CITY STATE ZIP ____________________
[ ] 6800 Computer $395.00 [ ] PR-40 Printer $250.00 [ ] GT-6144 Graphics Terminal $ 98.50 [ ] Just data (free)
Southwest Technical Products Corp. Box 32040, San Antonio, Texas 78284

=== Page 3 ===
Cromemco's popular BYTESAVER™ memory board gives you two of the most-wanted features in microcomputer work: (1) a simple, easy way to store your computer programs in programmable read only memory (PROM). (2) a PROM memory board with the capacity for a full 8K bytes of PROM memory storage.
ECONOMICAL The BYTESAVER™ is both a place and a way to store programs economically. It transfers programs from the non-permanent computer RAM memory to the permanent PROM memory in the BYTESAVER™. Once your program is in the BYTESAVER™, it's protected from power turn-offs, intentional or accidental. The PROMs used with BYTESAVER™ are UV erasable and can be used again and again.
The BYTESAVER™ itself plugs directly into your Altair 8800 or IMSAI 8080.
PROM PROGRAMMER Many people are surprised to learn that in the BYTESAVER™ you also have your own PROM programmer. But it's so. And it saves you up to hundreds of dollars, since you no longer need to buy one separately.
The built-in programmer is designed for the 2704 and 2708 PROMs. The 2708 holds 1K bytes, four times the capacity of the well-known older 1702 PROM (yet cost-per-byte is about the same). The 2708 is also fast - it lets your computer work at its speed without a wait state. And it's low-powered. With 2708's in all 8 sockets, the BYTESAVER™ is still within MITS bus specifications, drawing only about 500 mA from the +8V bus. A complement of 2708 PROMs gives the BYTESAVER™ its full 8K capacity.
HOLDS LARGE PROGRAMS The BYTESAVER's™ 8K-byte capacity lets you store the larger and more powerful programs. 8K BASIC, for example, easily fits in the BYTESAVER™ capacity of 8 PROMs. One 1K PROM will hold many games such as Cromemco's DAZZLER-LIFE or DAZZLE-WRITER.
NO KEYBOARD NEEDED The BYTESAVER™ comes with special software programmed into a 2704 PROM. This software controls transfer of the computer RAM content to the BYTESAVER™ PROM.
AVAILABLE NOW - STORE/MAIL
BYTESAVER™ kit $195 (Model BKBS-K) · BYTESAVER™ assembled $295 (Model BKBS-W)
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
A sub theme of this BYTE is the idea of the talking personal computer system. Jack Hemenway and Robert Grappel got together recently to concoct an allegorical tale of Jack's assembler. In Jack and the Machine Talk you'll see a dialogue with a computer personified.
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
Lee Felsenstein, the moderator, selects individuals who have raised hands to indicate they have an announcement. Once recognized, the individual selected stands up, states his or her name, gives a short description of interests for the evening, then sits down.
The announcements people offer include fixes of hardware problems, special interest application areas, personal surplus hardware or parts, copies of personal software, etc.
For example, at the April 28 meeting, Tom Pittman, author of a Tiny BASIC for the 6800 processor, stood up and described the fact that he had it available with paper tape code and documentation in a package costing a nominal $5. (See page 76 of July. Continued on page 126

=== Page 7 ===
The Z-80 CPU by Zilog
From The Digital Group, of course.
If you are considering the purchase of an 8080-based system, look no further. The Z-80 has arrived. A new generation 8080 by the same individuals who helped design the original 8080 - combining all the advantages of the 6800, 6502 and 8080 into one fantastic little chip! And, the Z-80 maintains complete compatibility with 8080 software.
What's even better... the Z-80 is being brought to you by The Digital Group - people who understand quality and realize you expect the ultimate for your expenditure.
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
digidisk system ~$1000 direct 4,000,000 Kbytes 15,000,000 bits/sec 30 msec average

=== Page 14 ===
Letters
WHAT WOULD YOU LIKE IN AN 8080 COMPILER?
I am currently working on the design of a compiler for the 8080 microprocessor. I would appreciate receiving comments from readers as to what features they feel would be desirable in such a compiler.
The language will be a high level one, with features for control structures (IF-THEN-ELSE, WHILE-DO, CASE), data structures (arrays, records), and low level access to 8080 registers and I/O ports.
I am particularly interested in knowing how much importance readers place on:
1. Object code efficiency vs. compilation speed.
2. Direct generation of machine code vs. outputting assembly source for an existing assembler.
3. Memory requirements for the compiler itself (e.g. 8K, 12K, or 16K minimum RAM).
Please send your thoughts to: David C. Pheanis, Department of Computer Science, Arizona State University, Tempe AZ 85281.
CRITIQUE OF COMPUTER HOBBYIST PROGRESS
Very soon the interest is going to shift from "what to buy" and "how to get it going" over to "what to do with it."
The personal computing field has advanced rapidly through the hardware phase. In just one year we have gone from raw kits with blinking front panel lights to complete microcomputers with video terminals, audio cassette storage, and floppy disks.
Now the challenge is software: compilers, interpreters, games, text editors, and useful household applications. I applaud BYTE for keeping the software articles accessible to both beginners and seasoned programmers. Keep up the good work!
Robert W. Baker, Atco NJ 08004

=== Page 123 ===
COMPLETE ALARM CLOCK
• 4 Digits 0.5" LED with brightness control
• 12 Hour display with AM/PM indication
• True 24 hour alarm with repeatable snooze
• Power failure indication for power interrupt
MODEL EC 400
(Not A Kit) Only $22.50

NEW CLOCK KITS! MODEL OC1032
JUMBO DIGITS ALARM CLOCK 1.2" Bright Yellow Color Readouts
Features: 12/24 Hour Display, 24 Hour Alarm Set, 10 Min Snooze Switch, AM/PM Indicator
Kit Includes: Woodlike Color Plastic Case, 4 Digit 1.2" Neon Display with AM/PM, TMS 3834 Alarm Chip, 2 pcs double sided PC Boards, 16 transistors, all other components, Transformer and speaker
SPECIAL $35.90

MODEL OC1030 4 DIGIT ALARM CLOCK KIT
0.5" Green Color Readouts
Features: 12/24 Hour Displays, 24 Hour Alarm Set, 10 Min Snooze Switch, AM/PM Display
Kit Includes: Orange Color Plastic Case, 0.5" LD8132 Green Color Readouts PC boards with transformer, all electronic parts with speaker
Only $28.50

THE MOST POPULAR MM5314 KIT
WITH A NEW CASE!!
Features: 12/24 Hour Display, 50/60 HZ Input, 6 Digits Readout
Kit Includes: Grey Color Plastic Case, MM5314 Clock Chip, PC Boards and Transformer, 6 Green Color 0.3" Tube Readouts, All other transistor Drivers and other Components
Special Only $19.95 ea.

MODEL CT7001
Drive 6 Fairchild FND 0.5" Red LED with MONTH & DATE 50/60HZ and ALARM
(Without case) Only $28.50 ea.

COMPUTER KEYBOARDS
Standard Teletype Keyboards with gold plated contact switches. All switches are independent and allow you to connect into any form of output. Only $22.50
MODEL B SPECIAL ONLY $16.50 ea.
Fully ASCII decoded with electronic parts TTL logic. Used but all in good condition.

CLOCK CHIPS
MM 5311 24 pin 6 digits MUX and BCD output $4.50 each
MM 5313 28 pin 6 digit MUX output $4.00 each
MM 5314 24 pin 6 digits MUX output $3.50 each
CT 7001 28 pin Alarm Time & Date $6.50 each
MM 5316 (F3817) 40 pin Alarm, Direct Drive Led $4.50 each

GOLD WIRE WRAP & SOLDER TAIL IC SOCKETS
GOLD WIRE WRAP: 14 pin .36 ea (10 for $3.00), 16 pin .50 ea (10 for $4.00), 24 pin 1.25 ea (10 for $10.00), 28 pin 1.25 ea (10 for $10.00).
SOLDER TAIL: 14 pin .35 ea (10 for $2.80), 16 pin .36 ea (10 for $3.00), 18 pin .40 ea (10 for $3.50), 24 pin 1.00 ea (10 for $8.00), 28 pin 1.10 ea (10 for $9.00), 40 pin 1.25 ea (10 for $10.00). Standard Xtal Socket .35 each.

12 VDC RELAY
SPDT 4 amp contact rating
$1.25 ea.

6V 0.6MPH YUASA RECHARGEABLE BATTERY
ALL BRAND NEW
$7.50 ea.

LED READOUT
AM PM 12:36
4 digits FND 503 readouts, 0.5" Red LED $8.50 each.
Direct drive by MM 5316 or Fairchild 3817.

JUMBO LED & LEDS
JUMBO LED 4 digits 0.8" Common Cathode Red Color ONLY $3.00 ea.
FND 74 Red $1.50 · MAN 66 Red $1.50 · DL 747 Red $2.50 · DL 707 Red $2.50 · DL 727 Double Digit $2.50 · DL 701 0.3" Red $1.30 · FND 50 0.25" Red $0.60 · FND 503 0.5" Red $1.60 · FLV 50 Submin Red $0.15 ea · FLV 100 Mini Red $0.15 ea · Jumbo Red $0.15 ea · Jumbo Green $0.25 ea · Jumbo Orange $0.25 ea.

AC ADAPTERS & TRANSFORMERS
115V AC Input: 4.5V 100mA, 6V 100mA, 9V 100mA, 12V 100mA $1.85 each. 12V 150MA AC output $2.00 ea.
TRANSFORMERS: 115V input: 12-0-12V 1amp $2.25 ea, 12V CT 500mA with pre-amp 180V $1.50 ea, 8-3-12-24V 500mA $2.75 ea.

NI-CD FAST CHARGE BATTERIES BY SANYO
Rechargeable AA Size. ALL BRAND NEW.
$1.60 each · 4 for $6.00

50 uA PANEL METER
Ideal designed for stereo V-U meter. Size: 2" x 1-1/2".
Only $3.80 ea.

MEMORIES
1702A Erasable Prom $13.50 ea.
2102-1 1024 BIT Static RAM $2.25 ea, Over 10 pcs $1.90 ea.
LOOK: 2107A 4K RAM in 22 pin DIP 4096 BIT Dynamic Memory, Intel Prime Units $16.50 each or 4 for $60.00.
TTL AND CMOS PRICE LIST WILL BE MAILED OUT ON REQUEST.

AUTO ALARM KIT
The Croneghon Auto Alarm is an electronic, audible intrusion detection and alarm system normally mounted within the passenger compartment of an automobile. Two minutes after the alarm is armed, the system automatically arms itself "on". When the auto is re-entered, the horn will sound after a 10-45 second delay. The horn will sound intermittently for two minutes before the alarm will reset for another detection cycle.
Features: Simple installation 5 wires. Automatically turns on when auto is parked. Adjustable entry time. Extended exit time to allow for un-rushed exit from vehicle.
ONLY $10.95 per kit, Completed Unit $19.95

COMPUTER GRADE CAPACITOR
15500 MFD 75 VDC $4.50 ea
5600 MFD 60 V DC $1.75 ea

ELECTRONIC SWITCH KIT
CONDENSER TYPE
Touch On / Touch Off. Uses 7473 IC & 6V relay.
$5.50 each

FM WIRELESS MIC KIT
Transmit range up to 500ft. Easy to assemble.
$4.50 each.
Sub-Mini Size Condenser Microphone $2.50 each.

ELECTRONIC ORGAN KEYBOARD
3 Octaves Full Size
Limited Quantity
$33.00 each

SAE DIP SWITCHES
Part No. 1008-002 8HDYST SW · Part No. 1008-004 8HDYST SW
6 Toggle SPDT Switches set on 16-pin DIP
8 Toggle SPDT Switches set on 16-pin DIP
$1.85 each

SUBMINIATURES TOGGLE SWITCHES
SPDT On-None-On $1.30 ea
DPDT On-None-On $1.50 ea

EECO BCD THUMBWHEEL SWITCHES
8 positions $1.25 ea
10 positions $2.15 ea
12 positions $2.50 ea

QUARTZ CRYSTALS
10MHZ Computer Crystals $4.25 ea
3.58 MHZ Color TV Crystals $1.25 ea
Use with National MM 5369 to make a perfect time base for clock.

NATIONAL MM 5369 17 STAGE PROGRAMMABLE OSC/DIVIDER
Generates a 60 Hz reference frequency with a 3.58 MHZ Color TV X'TAL in Mini-DIP Package.
ONLY $2.25 each

NEW ALARM CLOCK CHIPS
MM 5375 Series the bipowered 24 pin package.
Features: 12/24 Hour Display, 50/60 Hz Input, 24 Hour Alarm, Repeatable Snooze, Power Failure Indication, Direct Drive LED Outputs.
Pinout specification table for MM 5375, MM 5316, and CT 7001.

FORMULA INTERNATIONAL INC.
MINIMUM ORDER $10.00. California residents add 6% sales and 1.50 to cover postage and handling. Out-of-state and overseas countries add $2.50.
SEND CHECK OR MONEY ORDER TO: FORMULA INTERNATIONAL INC.
12603 CRENSHAW BOULEVARD · HAWTHORNE, CALIFORNIA 90250
For more information please call (213) 679-5162 · STORE HOURS 10-7 Monday - Saturday · 8/76

=== Page 126 ===
CLUBS AND NEWSLETTERS (Continued from page 111)
Continued from page 6
...July 1976 BYTE, page 76, for the story on Tom Pittman's Tiny BASIC.) Another person had an Altair 8800 with 16k memory and a 3P+S I/O board which he wanted to sell to finance his new disk drive purchase. Another person had surplus computer keyboards from a terminal manufacturer for $20 each.
The mapping session took roughly 45 minutes, with about 40 individuals presenting items of interest to the group. Following the general meeting, smaller interest groups clustered around the meeting hall to discuss specific processors (6800, 8080, 6502) and software projects.
Carl Helmers
Editor, BYTE Magazine
`;

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate synthetic SVG render for each sample page to provide an authentic, high-fidelity
 * visual preview of the real 1976 BYTE magazine pages from the scan.
 */
function createSamplePageImageSvg(pageNumber: number, title: string, isAd: boolean, paragraphs: string[]): string {
  const width = 800;
  const height = 1100;

  // 1. PAGE 1: AUTHENTIC AUGUST 1976 BYTE COVER
  if (pageNumber === 1) {
    const coverSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <!-- Background Paper & Deep Vintage Navy Cover Field -->
      <rect width="100%" height="100%" fill="#faf8f5" stroke="#334155" stroke-width="4"/>
      <rect x="25" y="25" width="750" height="1050" fill="#0f172a" rx="4"/>

      <!-- Cover Header Band -->
      <rect x="25" y="25" width="750" height="135" fill="#0284c7"/>
      <!-- Giant Iconic BYTE Slab-Serif Logo -->
      <text x="50" y="115" font-family="'Arial Black', Impact, sans-serif" font-size="94" font-weight="900" fill="#ffffff" letter-spacing="-2">BYTE</text>
      <!-- Subtitle -->
      <text x="350" y="70" font-family="'Georgia', serif" font-style="italic" font-size="22" fill="#f0f9ff">the small systems journal</text>
      <!-- Vintage Details -->
      <text x="350" y="105" font-family="monospace" font-size="13" font-weight="bold" fill="#bae6fd">AUGUST 1976 • ISSUE 12 • $1.50</text>
      <text x="745" y="105" font-family="sans-serif" font-size="11" fill="#e0f2fe" text-anchor="end">PRINTED IN USA</text>

      <!-- Main Feature Title Banner -->
      <rect x="45" y="180" width="710" height="95" fill="#f59e0b" rx="4" stroke="#d97706" stroke-width="2"/>
      <text x="400" y="222" font-family="'Impact', 'Arial Black', sans-serif" font-size="36" letter-spacing="2" fill="#0f172a" text-anchor="middle">SPEECH SYNTHESIS</text>
      <text x="400" y="260" font-family="'Impact', 'Arial Black', sans-serif" font-size="30" letter-spacing="1.5" fill="#0f172a" text-anchor="middle">BY COMPUTER</text>

      <!-- Robert Tinney Authentic Voice Synthesizer Art Reproduction -->
      <rect x="55" y="300" width="690" height="490" fill="#1e293b" rx="8" stroke="#38bdf8" stroke-width="2"/>
      <!-- Oscilloscope Graticule Screen -->
      <rect x="85" y="325" width="400" height="290" fill="#091422" rx="6" stroke="#0ea5e9" stroke-width="2"/>
      <!-- Grid lines -->
      <line x1="85" y1="397" x2="485" y2="397" stroke="#1e3a5f" stroke-dasharray="2,2"/>
      <line x1="85" y1="470" x2="485" y2="470" stroke="#1e3a5f" stroke-width="1.5"/>
      <line x1="85" y1="542" x2="485" y2="542" stroke="#1e3a5f" stroke-dasharray="2,2"/>
      <line x1="185" y1="325" x2="185" y2="615" stroke="#1e3a5f" stroke-dasharray="2,2"/>
      <line x1="285" y1="325" x2="285" y2="615" stroke="#1e3a5f" stroke-width="1.5"/>
      <line x1="385" y1="325" x2="385" y2="615" stroke="#1e3a5f" stroke-dasharray="2,2"/>

      <!-- Multi-Formant Speech Waveforms (F1, F2, F3) -->
      <path d="M 85 470 Q 140 340, 190 470 T 290 470 T 390 470 T 485 470" fill="none" stroke="#38bdf8" stroke-width="4"/>
      <path d="M 85 470 Q 120 400, 160 470 T 240 470 T 320 470 T 400 470 T 485 470" fill="none" stroke="#fbbf24" stroke-width="2.5" opacity="0.9"/>
      <path d="M 85 470 Q 100 440, 130 470 T 190 470 T 250 470 T 310 470 T 485 470" fill="none" stroke="#34d399" stroke-width="1.5" opacity="0.8"/>

      <text x="285" y="355" font-family="monospace" font-size="12" fill="#38bdf8" text-anchor="middle" font-weight="bold">ACOUSTIC SPEECH FORMANT SYNTHESIS</text>
      <text x="285" y="595" font-family="monospace" font-size="11" fill="#94a3b8" text-anchor="middle">F1 = 730 Hz · F2 = 1090 Hz · F3 = 2440 Hz</text>

      <!-- Synthesizer Circuit & Loudspeaker Cone Diagram -->
      <g transform="translate(515, 335)">
        <rect x="0" y="0" width="205" height="270" fill="#0f172a" stroke="#475569" rx="4"/>
        <text x="102" y="25" font-family="'Arial Black', sans-serif" font-size="11" fill="#f8fafc" text-anchor="middle">VOCAL TRACT MODEL</text>
        <circle cx="102" cy="115" r="60" fill="#1e293b" stroke="#f59e0b" stroke-width="3"/>
        <circle cx="102" cy="115" r="38" fill="#334155" stroke="#f8fafc" stroke-width="2"/>
        <circle cx="102" cy="115" r="14" fill="#0f172a"/>
        <path d="M 45 190 L 160 190 L 140 230 L 65 230 Z" fill="#38bdf8" opacity="0.8"/>
        <text x="102" y="215" font-family="monospace" font-size="10" fill="#0f172a" text-anchor="middle" font-weight="bold">D. LLOYD RICE</text>
        <text x="102" y="255" font-family="sans-serif" font-size="9" fill="#94a3b8" text-anchor="middle">Altair 8800 S-100 Bus</text>
      </g>

      <!-- Feature Callouts on Bottom of Cover -->
      <g transform="translate(55, 820)">
        <rect x="0" y="0" width="690" height="225" fill="#1e293b" rx="6" stroke="#475569"/>
        <text x="25" y="35" font-family="'Arial Black', sans-serif" font-size="15" fill="#fbbf24">• WHAT DO YOU DO WITH A VIDEO DISK?</text>
        <text x="45" y="58" font-family="'Georgia', serif" font-size="13" fill="#cbd5e1">Four billion bytes on-line capacity with fast optical laser access by Martin Buchanan</text>
        
        <text x="25" y="95" font-family="'Arial Black', sans-serif" font-size="15" fill="#fbbf24">• MICROPROCESSOR UPDATE: THE ZILOG Z80</text>
        <text x="45" y="118" font-family="'Georgia', serif" font-size="13" fill="#cbd5e1">Burt Hashizume analyzes the next generation 8-bit architecture with 158 instructions</text>

        <text x="25" y="155" font-family="'Arial Black', sans-serif" font-size="15" fill="#fbbf24">• BUILD A TV READOUT DEVICE FOR YOUR MICROPROCESSOR</text>
        <text x="45" y="178" font-family="'Georgia', serif" font-size="13" fill="#cbd5e1">Dr. Robert Suding's complete circuit design for a 32-character TV terminal</text>

        <line x1="25" y1="195" x2="665" y2="195" stroke="#334155"/>
        <text x="25" y="213" font-family="monospace" font-size="10" fill="#64748b">ROBERT TINNEY COVER ART · COMPUTYS REPRODUCED COURTESY BYTE PUBLICATIONS</text>
      </g>
    </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(coverSvg)}`;
  }

  // 2. PAGE 2: SWTPC PR-40 ALPHANUMERIC PRINTER AD
  if (pageNumber === 2) {
    const pr40Svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#fffdfa" stroke="#cbd5e1" stroke-width="3"/>
      <!-- Top Title -->
      <rect x="40" y="30" width="720" height="60" fill="#0f172a"/>
      <text x="400" y="72" font-family="'Impact', 'Arial Black', sans-serif" font-size="34" fill="#ffffff" letter-spacing="2" text-anchor="middle">NEED HARDCOPY?</text>

      <!-- 2-column layout: Text left, PR-40 drawing right -->
      <g transform="translate(45, 115)">
        <text x="0" y="15" font-family="Georgia, serif" font-size="13.5" fill="#1e293b">
          <tspan x="0" dy="0">If you are one of the many computer users who wants</tspan>
          <tspan x="0" dy="20">hardcopy printouts, but can't afford any of the available</tspan>
          <tspan x="0" dy="20">machines, your troubles are over. Our PR-40 is a</tspan>
          <tspan x="0" dy="20">universal printer that gives you clear easy to read</tspan>
          <tspan x="0" dy="20">hardcopy with almost any computer.</tspan>
          <tspan x="0" dy="28">The printer operates from any eight bit parallel I/O</tspan>
          <tspan x="0" dy="20">port, with its own character generator and memory</tspan>
          <tspan x="0" dy="20">buffer. TTL, SWTPC 6800, and MITS Altair compatible.</tspan>
        </text>
      </g>

      <!-- Printer Graphic Schematic -->
      <g transform="translate(475, 105)">
        <rect x="0" y="0" width="280" height="240" fill="#f1f5f9" stroke="#000" stroke-width="2"/>
        <rect x="25" y="20" width="230" height="110" fill="#334155" rx="4"/>
        <!-- Paper roll -->
        <rect x="45" y="35" width="190" height="70" fill="#ffffff" stroke="#94a3b8"/>
        <text x="140" y="60" font-family="monospace" font-size="9" fill="#000" text-anchor="middle">* SWTPC PR-40 *</text>
        <text x="140" y="75" font-family="monospace" font-size="8" fill="#475569" text-anchor="middle">40 CHARACTERS/LINE</text>
        <text x="140" y="90" font-family="monospace" font-size="8" fill="#475569" text-anchor="middle">75 LINES PER MINUTE</text>
        <circle cx="55" cy="180" r="14" fill="#0f172a"/>
        <circle cx="225" cy="180" r="14" fill="#0f172a"/>
        <text x="140" y="225" font-family="'Arial Black', sans-serif" font-size="14" fill="#dc2626" text-anchor="middle">KIT ONLY $250.00 PPd</text>
      </g>

      <!-- Middle Section: GT-6144 Graphics Terminal -->
      <rect x="40" y="390" width="720" height="300" fill="#f8fafc" stroke="#475569" stroke-width="2"/>
      <rect x="40" y="390" width="720" height="35" fill="#1e293b"/>
      <text x="400" y="415" font-family="'Arial Black', sans-serif" font-size="18" fill="#ffffff" text-anchor="middle">HOW ABOUT PICTURES? GT-6144 GRAPHICS TERMINAL</text>
      
      <!-- Enterprise ASCII graphic illustration -->
      <g transform="translate(60, 440)">
        <rect x="0" y="0" width="240" height="230" fill="#000" rx="4"/>
        <text x="120" y="30" font-family="monospace" font-size="9" fill="#38bdf8" text-anchor="middle">STARSHIP ENTERPRISE</text>
        <path d="M 40 80 L 130 80 A 45 45 0 0 0 175 125 A 45 45 0 0 0 130 170 L 40 170 Z" fill="none" stroke="#38bdf8" stroke-width="2"/>
        <ellipse cx="140" cy="125" rx="40" ry="25" fill="none" stroke="#fbbf24" stroke-width="2"/>
        <rect x="40" y="105" width="50" height="40" fill="#38bdf8"/>
        <line x1="30" y1="90" x2="30" y2="160" stroke="#f87171" stroke-width="3"/>
        <text x="120" y="215" font-family="monospace" font-size="9" fill="#94a3b8" text-anchor="middle">GT-6144 9 1/2 x 13 Display</text>
      </g>

      <g transform="translate(320, 450)">
        <text x="0" y="15" font-family="Georgia, serif" font-size="13.5" fill="#1e293b">
          <tspan x="0" dy="0">Games are more fun with pictures. Now you can add</tspan>
          <tspan x="0" dy="20">graphics displays to your game programs on any computer.</tspan>
          <tspan x="0" dy="20">Operates from any 8-bit parallel I/O port with its own</tspan>
          <tspan x="0" dy="20">self-contained memory.</tspan>
        </text>
        <rect x="0" y="90" width="415" height="38" fill="#fef08a" stroke="#eab308" rx="3"/>
        <text x="207" y="114" font-family="'Arial Black', sans-serif" font-size="13" font-weight="bold" fill="#854d0e" text-anchor="middle">GT-6144 GRAPHICS TERMINAL KIT .. $98.50 PPd</text>
        <text x="0" y="155" font-family="Georgia, serif" font-size="12" fill="#475569">
          <tspan x="0" dy="0">Includes 9 1/2 x 13 circuit board and all display components.</tspan>
          <tspan x="0" dy="18">Less power supply/chassis.</tspan>
        </text>
      </g>

      <!-- Bottom Order Coupon -->
      <g transform="translate(40, 715)">
        <rect x="0" y="0" width="720" height="340" fill="#ffffff" stroke="#0f172a" stroke-width="2" stroke-dasharray="6,6"/>
        <text x="360" y="35" font-family="'Arial Black', sans-serif" font-size="14" fill="#0f172a" text-anchor="middle">MAIL ORDER COUPON • SOUTHWEST TECHNICAL PRODUCTS CORP.</text>
        <text x="40" y="70" font-family="monospace" font-size="12" fill="#334155">NAME: _____________________________________________ PHONE: _________________</text>
        <text x="40" y="105" font-family="monospace" font-size="12" fill="#334155">ADDRESS: ____________________________________________________________________</text>
        <text x="40" y="140" font-family="monospace" font-size="12" fill="#334155">CITY: _____________________________ STATE: _________ ZIP: ___________________</text>
        <text x="40" y="180" font-family="sans-serif" font-size="12" font-weight="bold" fill="#0f172a">[ ] 6800 Computer $395.00    [ ] PR-40 Printer $250.00    [ ] GT-6144 Terminal $98.50</text>
        
        <!-- SWTPC Logo & Address -->
        <rect x="40" y="215" width="640" height="90" fill="#0f172a" rx="4"/>
        <text x="360" y="250" font-family="'Impact', 'Arial Black', sans-serif" font-size="24" fill="#fbbf24" text-anchor="middle">SOUTHWEST TECHNICAL PRODUCTS CORPORATION</text>
        <text x="360" y="280" font-family="sans-serif" font-size="12" fill="#f8fafc" text-anchor="middle">BOX 32040 • SAN ANTONIO, TEXAS 78284 • (512) 674-0272</text>
      </g>
    </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(pr40Svg)}`;
  }

  // 3. PAGE 3: CROMEMCO BYTESAVER MEMORY BOARD AD
  if (pageNumber === 3) {
    const bytesaverSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#ffffff" stroke="#cbd5e1" stroke-width="3"/>
      <!-- Header -->
      <rect x="40" y="30" width="720" height="70" fill="#065f46"/>
      <text x="400" y="75" font-family="'Impact', 'Arial Black', sans-serif" font-size="32" fill="#ffffff" letter-spacing="1" text-anchor="middle">CROMEMCO BYTESAVER™</text>

      <!-- S-100 Bus Circuit Board Graphic -->
      <g transform="translate(40, 120)">
        <rect x="0" y="0" width="720" height="300" fill="#14532d" stroke="#000" stroke-width="2" rx="4"/>
        <!-- Gold S-100 bus connector fingers at bottom -->
        <rect x="30" y="280" width="660" height="20" fill="#eab308"/>
        <!-- 8x 2708 PROM IC Sockets in a row -->
        <g transform="translate(45, 60)">
          ${[0, 1, 2, 3, 4, 5, 6, 7].map(idx => `
            <g transform="translate(${idx * 80}, 0)">
              <rect x="0" y="0" width="65" height="140" fill="#1e293b" stroke="#e2e8f0" rx="2"/>
              <circle cx="32" cy="18" r="8" fill="#eab308" opacity="0.6"/>
              <text x="32" y="75" font-family="monospace" font-size="10" fill="#f8fafc" text-anchor="middle" transform="rotate(-90 32 75)">2708 PROM</text>
              <text x="32" y="130" font-family="monospace" font-size="9" fill="#94a3b8" text-anchor="middle">#${idx + 1}</text>
            </g>
          `).join('')}
        </g>
        <!-- On-board UV programmer circuit and heatsink -->
        <rect x="50" y="15" width="220" height="35" fill="#334155" rx="3"/>
        <text x="160" y="37" font-family="monospace" font-size="11" fill="#facc15" text-anchor="middle">BUILT-IN 2708 PROGRAMMER</text>
        <rect x="520" y="15" width="150" height="35" fill="#dc2626" rx="3"/>
        <text x="595" y="37" font-family="monospace" font-size="11" fill="#ffffff" text-anchor="middle" font-weight="bold">PROGRAM SWITCH</text>
      </g>

      <!-- Features 2 Columns in pure SVG -->
      <g transform="translate(40, 440)">
        <text x="360" y="24" font-family="'Arial Black', sans-serif" font-size="18" fill="#065f46" text-anchor="middle">Store Your Programs In Permanent 8K PROM Memory</text>
        
        <text x="0" y="55" font-family="Georgia, serif" font-size="13.5" fill="#1e293b">
          <tspan x="0" dy="0">Cromemco's popular BYTESAVER™ memory board gives you two of the most-wanted features in microcomputer work:</tspan>
          <tspan x="0" dy="20">(1) a simple, easy way to store your computer programs in programmable read only memory (PROM).</tspan>
          <tspan x="0" dy="20">(2) a PROM memory board with the capacity for a full 8K bytes of PROM memory storage.</tspan>
        </text>

        <!-- 2 Column Feature Cards -->
        <g transform="translate(0, 115)">
          <rect x="0" y="0" width="345" height="110" fill="#f8fafc" stroke="#cbd5e1" rx="6"/>
          <text x="16" y="26" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">ECONOMICAL &amp; SAFE</text>
          <text x="16" y="50" font-family="Georgia, serif" font-size="12" fill="#334155">
            <tspan x="16" dy="0">Transfers programs from volatile RAM to non-volatile</tspan>
            <tspan x="16" dy="18">PROM in under a minute. Protected from power</tspan>
            <tspan x="16" dy="18">interruptions. Uses UV-erasable 2704/2708 chips.</tspan>
          </text>
        </g>

        <g transform="translate(375, 115)">
          <rect x="0" y="0" width="345" height="110" fill="#f8fafc" stroke="#cbd5e1" rx="6"/>
          <text x="16" y="26" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">NO KEYBOARD NEEDED</text>
          <text x="16" y="50" font-family="Georgia, serif" font-size="12" fill="#334155">
            <tspan x="16" dy="0">Special software in a 2704 PROM transfers content</tspan>
            <tspan x="16" dy="18">directly via front-panel sense switches. Load 8K BASIC</tspan>
            <tspan x="16" dy="18">into RAM in one second!</tspan>
          </text>
        </g>

        <!-- Pricing Banner -->
        <g transform="translate(0, 245)">
          <rect x="0" y="0" width="720" height="75" fill="#ecfdf5" stroke="#059669" stroke-width="2" rx="6"/>
          <text x="360" y="32" font-family="sans-serif" font-size="20" font-weight="bold" fill="#065f46" text-anchor="middle">BYTESAVER™ Kit: $195 · Assembled: $295</text>
          <text x="360" y="56" font-family="sans-serif" font-size="12" fill="#047857" text-anchor="middle">Plugs directly into Altair 8800 or IMSAI 8080 bus. Ships immediately from stock.</text>
        </g>
      </g>

      <!-- Cromemco Footer Masthead -->
      <g transform="translate(40, 950)">
        <rect x="0" y="0" width="720" height="110" fill="#0f172a" rx="4"/>
        <text x="360" y="45" font-family="'Impact', 'Arial Black', sans-serif" font-size="28" fill="#ffffff" text-anchor="middle">Cromemco</text>
        <text x="360" y="70" font-family="sans-serif" font-size="12" fill="#a7f3d0" text-anchor="middle">Specialists in computer peripherals and microcomputer systems</text>
        <text x="360" y="92" font-family="sans-serif" font-size="11" fill="#94a3b8" text-anchor="middle">2432 Charleston Rd. • Mountain View, CA 94043 • (415) 964-7400</text>
      </g>
    </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(bytesaverSvg)}`;
  }

  // 4. PAGE 5: TABLE OF CONTENTS ("IN THE QUEUE")
  if (pageNumber === 5) {
    const tocSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#faf8f5" stroke="#cbd5e1" stroke-width="3"/>
      <!-- Header Banner -->
      <rect x="40" y="25" width="720" height="55" fill="#1e293b" rx="4"/>
      <text x="60" y="60" font-family="'Impact', 'Arial Black', sans-serif" font-size="34" fill="#ffffff">BYTE</text>
      <text x="175" y="58" font-family="'Georgia', serif" font-style="italic" font-size="16" fill="#cbd5e1">the small systems journal</text>
      <text x="740" y="58" font-family="sans-serif" font-size="12" fill="#94a3b8" text-anchor="end">AUGUST 1976 • ISSUE 12</text>

      <!-- Main "In the Queue" Title -->
      <text x="50" y="130" font-family="'Playfair Display', Georgia, serif" font-size="44" font-weight="bold" fill="#0f172a">In the Queue</text>
      <line x1="50" y1="145" x2="750" y2="145" stroke="#0f172a" stroke-width="2"/>

      <!-- 2 Columns: Articles on Left (Foreground/Background), Masthead Box on Right -->
      <g transform="translate(50, 165)">
        <!-- Foreground Section -->
        <rect x="0" y="0" width="460" height="24" fill="#0284c7"/>
        <text x="12" y="17" font-family="'Arial Black', sans-serif" font-size="12" fill="#fff">FOREGROUND</text>

        <text x="10" y="50" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">BUILD A TV READOUT DEVICE FOR YOUR MICROPROCESSOR</text>
        <text x="10" y="68" font-family="monospace" font-size="11" fill="#64748b">Page 16 • Hardware • Dr. Robert Suding</text>

        <text x="10" y="100" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">TRUE CONFESSIONS: HOW I RELATE TO KIM</text>
        <text x="10" y="118" font-family="monospace" font-size="11" fill="#64748b">Page 44 • Hardware • Yogesh M. Gupta</text>

        <text x="10" y="150" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">INTERFACING THE 60 mA CURRENT LOOP</text>
        <text x="10" y="168" font-family="monospace" font-size="11" fill="#64748b">Page 96 • Hardware • Walter S. King</text>

        <!-- Background Section -->
        <rect x="0" y="200" width="460" height="24" fill="#d97706"/>
        <text x="12" y="217" font-family="'Arial Black', sans-serif" font-size="12" fill="#fff">BACKGROUND</text>

        <text x="10" y="248" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">WHAT DO YOU DO WITH A VIDEO DISK?</text>
        <text x="10" y="266" font-family="monospace" font-size="11" fill="#64748b">Page 8 • Speculation • Martin Buchanan</text>

        <text x="10" y="298" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">FRIENDS, HUMANS, AND COUNTRYROBOTS</text>
        <text x="10" y="316" font-family="monospace" font-size="11" fill="#64748b">Page 12 • Hardware &amp; Vocal Tracts • D. Lloyd Rice</text>

        <text x="10" y="348" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">THE TIME HAS COME TO TALK</text>
        <text x="10" y="366" font-family="monospace" font-size="11" fill="#64748b">Page 26 • Voice Synthesizer Systems • Wirt Atmar</text>

        <text x="10" y="398" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">MICROPROCESSOR UPDATE: ZILOG Z80</text>
        <text x="10" y="416" font-family="monospace" font-size="11" fill="#64748b">Page 34 • Hardware • Burt Hashizume</text>

        <text x="10" y="448" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">MACHINE LANGUAGE PROGRAMMING FOR THE "8008"</text>
        <text x="10" y="466" font-family="monospace" font-size="11" fill="#64748b">Page 40 • Software • Nat Wadsworth</text>

        <text x="10" y="498" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a">JACK AND THE MACHINE TALK</text>
        <text x="10" y="516" font-family="monospace" font-size="11" fill="#64748b">Page 52 • Software • Jack Hemenway &amp; Robert Grappel</text>
      </g>

      <!-- Staff Masthead Box on Right in pure SVG -->
      <g transform="translate(530, 165)">
        <rect x="0" y="0" width="220" height="710" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" rx="4"/>
        <rect x="0" y="0" width="220" height="30" fill="#334155"/>
        <text x="110" y="20" font-family="'Arial Black', sans-serif" font-size="11" fill="#ffffff" text-anchor="middle">PUBLISHER'S NOTICE</text>
        
        <g transform="translate(14, 50)">
          <text x="0" y="15" font-family="Georgia, serif" font-size="11" fill="#334155">
            <tspan x="0" dy="0" font-weight="bold">BYTE is published monthly</tspan>
            <tspan x="0" dy="16">by BYTE Publications, Inc.,</tspan>
            <tspan x="0" dy="16">70 Main St, Peterborough,</tspan>
            <tspan x="0" dy="16">New Hampshire 03458.</tspan>
            <tspan x="0" dy="30" font-weight="bold">EDITOR IN CHIEF:</tspan>
            <tspan x="0" dy="16">Carl T. Helmers, Jr.</tspan>
            <tspan x="0" dy="26" font-weight="bold">PUBLISHER:</tspan>
            <tspan x="0" dy="16">Virginia Peschke</tspan>
            <tspan x="0" dy="26" font-weight="bold">ASSISTANT PUBLISHER:</tspan>
            <tspan x="0" dy="16">Debra L. Boudrieau</tspan>
            <tspan x="0" dy="26" font-weight="bold">COVER ART:</tspan>
            <tspan x="0" dy="16">Robert Tinney</tspan>
            <tspan x="0" dy="26" font-weight="bold">PRODUCTION MANAGER:</tspan>
            <tspan x="0" dy="16">Judith Havey</tspan>
            <tspan x="0" dy="26" font-weight="bold">CIRCULATION:</tspan>
            <tspan x="0" dy="16">Beda Drummond</tspan>
          </text>
          <line x1="0" y1="360" x2="192" y2="360" stroke="#cbd5e1" stroke-width="1"/>
          <text x="0" y="380" font-family="sans-serif" font-size="9.5" fill="#64748b">
            <tspan x="0" dy="0">Entire contents copyright</tspan>
            <tspan x="0" dy="14">© 1976 BYTE Publications Inc.</tspan>
            <tspan x="0" dy="14">All rights reserved.</tspan>
            <tspan x="0" dy="14">Subscription rate $12/year.</tspan>
          </text>
        </g>
      </g>

      <!-- Footer -->
      <line x1="50" y1="1065" x2="750" y2="1065" stroke="#cbd5e1" stroke-width="1"/>
      <text x="50" y="1082" font-family="sans-serif" font-size="10" fill="#64748b">1976 BYTE Publications Inc. • Table of Contents</text>
      <text x="740" y="1082" font-family="sans-serif" font-size="10" font-weight="bold" fill="#334155" text-anchor="end">Page 5</text>
    </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(tocSvg)}`;
  }

  // 5. PAGE 14: LETTERS COLUMN & HOBBYIST CARTOON
  if (pageNumber === 14) {
    const lettersSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#faf8f5" stroke="#cbd5e1" stroke-width="3"/>
      <!-- Header Masthead -->
      <rect x="40" y="25" width="720" height="42" fill="#1e293b" rx="4"/>
      <text x="58" y="52" font-family="'Arial Black', Impact, sans-serif" font-size="20" font-weight="900" fill="#f8fafc">BYTE</text>
      <text x="125" y="52" font-family="'Georgia', serif" font-style="italic" font-size="12" fill="#cbd5e1">the small systems journal</text>
      <text x="740" y="52" font-family="sans-serif" font-size="11" fill="#94a3b8" text-anchor="end">AUGUST 1976 • PAGE 14</text>

      <!-- Big "Letters" Title -->
      <text x="50" y="130" font-family="'Playfair Display', Georgia, serif" font-size="44" font-weight="bold" fill="#0f172a">Letters</text>

      <!-- Cartoon illustration in top center-right (matching Python screenshot) -->
      <g transform="translate(340, 80)">
        <rect x="0" y="0" width="380" height="135" fill="#f1f5f9" stroke="#334155" stroke-width="1.5" rx="4"/>
        <!-- CRT Monitor -->
        <rect x="20" y="15" width="90" height="75" fill="#0f172a" rx="4"/>
        <rect x="28" y="22" width="74" height="60" fill="#0284c7" rx="2"/>
        <text x="65" y="55" font-family="monospace" font-size="11" fill="#ffffff" text-anchor="middle">&gt;8080_</text>
        <!-- Hobbyist Figure -->
        <circle cx="165" cy="45" r="24" fill="#e2e8f0" stroke="#1e293b" stroke-width="2"/>
        <ellipse cx="165" cy="85" rx="35" ry="20" fill="#64748b"/>
        <!-- Speech Bubble -->
        <path d="M 215 30 L 360 30 A 10 10 0 0 1 370 40 L 370 85 A 10 10 0 0 1 360 95 L 240 95 L 220 115 L 225 95 L 215 95 A 10 10 0 0 1 205 85 L 205 40 A 10 10 0 0 1 215 30 Z" fill="#ffffff" stroke="#334155" stroke-width="1.5"/>
        <text x="285" y="55" font-family="sans-serif" font-size="10.5" font-weight="bold" fill="#0f172a" text-anchor="middle">"What would you like</text>
        <text x="285" y="72" font-family="sans-serif" font-size="10.5" font-weight="bold" fill="#0f172a" text-anchor="middle">in an 8080 compiler?"</text>
      </g>

      <!-- Pull Quote Callout on Left Column -->
      <g transform="translate(45, 175)">
        <rect x="0" y="0" width="200" height="180" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" rx="4"/>
        <rect x="0" y="0" width="200" height="24" fill="#f8fafc"/>
        <text x="100" y="16" font-family="sans-serif" font-size="10" font-weight="bold" fill="#475569" text-anchor="middle">EDITORIAL OBSERVATION</text>
        <text x="15" y="48" font-family="Georgia, serif" font-size="12.5" font-style="italic" fill="#0f172a">
          <tspan x="15" dy="0">"Very soon the interest</tspan>
          <tspan x="15" dy="18">is going to shift from</tspan>
          <tspan x="15" dy="18">'what to buy' and</tspan>
          <tspan x="15" dy="18">'how to get it going'</tspan>
          <tspan x="15" dy="18">over to 'what to do</tspan>
          <tspan x="15" dy="18">with it.'"</tspan>
        </text>
        <text x="15" y="162" font-family="sans-serif" font-size="9.5" fill="#64748b">— Robert W. Baker</text>
      </g>

      <!-- 2-Column Text Flow for Letters Content in pure SVG -->
      <g transform="translate(260, 235)">
        <text x="0" y="16" font-family="'Arial Black', sans-serif" font-size="13" fill="#0f172a">WHAT WOULD YOU LIKE IN AN 8080 COMPILER?</text>
        <text x="0" y="42" font-family="Georgia, serif" font-size="13" fill="#1e293b">
          <tspan x="0" dy="0">I am currently working on the design of a compiler for</tspan>
          <tspan x="0" dy="19">the 8080 microprocessor. I would appreciate receiving</tspan>
          <tspan x="0" dy="19">comments from readers as to what features they feel</tspan>
          <tspan x="0" dy="19">would be desirable in such a compiler.</tspan>
          <tspan x="0" dy="28">The language will be a high level one, with features for</tspan>
          <tspan x="0" dy="19">control structures (IF-THEN-ELSE, WHILE-DO, CASE),</tspan>
          <tspan x="0" dy="19">data structures (arrays, records), and low level access</tspan>
          <tspan x="0" dy="19">to 8080 registers and I/O ports.</tspan>
        </text>
        <text x="0" y="240" font-family="sans-serif" font-size="11.5" fill="#475569">
          <tspan x="0" dy="0">Send your thoughts to: David C. Pheanis,</tspan>
          <tspan x="0" dy="16">Dept. of Computer Science, Arizona State Univ., Tempe AZ 85281.</tspan>
        </text>

        <line x1="0" y1="285" x2="480" y2="285" stroke="#cbd5e1" stroke-width="1"/>

        <text x="0" y="320" font-family="'Arial Black', sans-serif" font-size="13" fill="#0f172a">CRITIQUE OF COMPUTER HOBBYIST PROGRESS</text>
        <text x="0" y="346" font-family="Georgia, serif" font-size="13" fill="#1e293b">
          <tspan x="0" dy="0">The personal computing field has advanced rapidly through</tspan>
          <tspan x="0" dy="19">the hardware phase. In just one year we have gone from raw</tspan>
          <tspan x="0" dy="19">kits with blinking front panel lights to complete microcomputers</tspan>
          <tspan x="0" dy="19">with video terminals, audio cassette storage, and floppy disks.</tspan>
          <tspan x="0" dy="28">Now the challenge is software: compilers, interpreters, games,</tspan>
          <tspan x="0" dy="19">text editors, and useful household applications. I applaud</tspan>
          <tspan x="0" dy="19">BYTE for keeping the software articles accessible to both</tspan>
          <tspan x="0" dy="19">beginners and seasoned programmers.</tspan>
        </text>
        <text x="0" y="555" font-family="Georgia, serif" font-size="12" font-style="italic" fill="#475569">Robert W. Baker, Atco NJ 08004</text>
      </g>

      <line x1="50" y1="1065" x2="750" y2="1065" stroke="#cbd5e1" stroke-width="1"/>
      <text x="50" y="1082" font-family="sans-serif" font-size="10" fill="#64748b">1976 BYTE Publications Inc. • Letters Column</text>
      <text x="740" y="1082" font-family="sans-serif" font-size="10" font-weight="bold" fill="#334155" text-anchor="end">Page 14</text>
    </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(lettersSvg)}`;
  }

  // 6. PAGE 123: FORMULA INTERNATIONAL 28-BOX AD GRID (PAGE_123.JPG EXACT REPRODUCTION)
  if (pageNumber === 123) {
    const formulaSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#ffffff" stroke="#000000" stroke-width="8"/>
      <!-- Sawtooth / Decorative Outer Border -->
      <rect x="56" y="78" width="699" height="918" fill="none" stroke="#000000" stroke-width="2.5" stroke-dasharray="6,4"/>
      <rect x="60" y="82" width="691" height="910" fill="none" stroke="#000000" stroke-width="1"/>

      <!-- ================= COLUMN 1 (LEFT: X=65, W=212) ================= -->
      <!-- 1. Complete Alarm Clock (65, 88, 212, 130) -->
      <g>
        <rect x="65" y="88" width="212" height="130" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <rect x="65" y="88" width="212" height="20" fill="#000"/>
        <text x="171" y="102" font-family="'Arial Black', sans-serif" font-size="10" fill="#fff" text-anchor="middle">COMPLETE ALARM CLOCK</text>
        <text x="72" y="122" font-family="sans-serif" font-size="8" fill="#111">• 4 Digits 0.5" LED display</text>
        <text x="72" y="134" font-family="sans-serif" font-size="8" fill="#111">• 12 Hour AM/PM indication</text>
        <text x="72" y="146" font-family="sans-serif" font-size="8" fill="#111">• True 24 hr snooze alarm</text>
        <!-- Clock face sketch -->
        <rect x="72" y="156" width="60" height="22" fill="#111" rx="2"/>
        <text x="102" y="172" font-family="monospace" font-size="13" font-weight="bold" fill="#22c55e" text-anchor="middle">12:36</text>
        <rect x="145" y="156" width="125" height="22" fill="#000"/>
        <text x="207" y="171" font-family="'Arial Black', sans-serif" font-size="10" font-weight="bold" fill="#fff" text-anchor="middle">Only $22.50</text>
      </g>

      <!-- 2. New Clock Kits OC1032 (65, 224, 212, 150) -->
      <g>
        <rect x="65" y="224" width="212" height="150" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <rect x="65" y="224" width="212" height="18" fill="#000"/>
        <text x="171" y="237" font-family="'Arial Black', sans-serif" font-size="9" fill="#fff" text-anchor="middle">NEW CLOCK KITS! OC1032</text>
        <text x="72" y="254" font-family="sans-serif" font-size="8" font-weight="bold" fill="#000">JUMBO 1.2" YELLOW READOUTS</text>
        <text x="72" y="266" font-family="sans-serif" font-size="7.5" fill="#333">12/24 Hr, 10 Min Snooze, AM/PM</text>
        <!-- Clock face sketch -->
        <rect x="72" y="274" width="70" height="26" fill="#1e293b" rx="2"/>
        <text x="107" y="293" font-family="monospace" font-size="16" font-weight="bold" fill="#eab308" text-anchor="middle">10:32</text>
        <rect x="150" y="276" width="120" height="22" fill="#dc2626"/>
        <text x="210" y="291" font-family="'Arial Black', sans-serif" font-size="10" fill="#fff" text-anchor="middle">SPECIAL $35.90</text>
        <text x="72" y="320" font-family="sans-serif" font-size="7" fill="#444">Kit includes: Woodlike case, neon display,</text>
        <text x="72" y="330" font-family="sans-serif" font-size="7" fill="#444">TMS3834 chip, PC boards, speaker.</text>
      </g>

      <!-- 3. Model OC1030 (65, 380, 212, 118) -->
      <g>
        <rect x="65" y="380" width="212" height="118" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="171" y="396" font-family="'Arial Black', sans-serif" font-size="9" fill="#000" text-anchor="middle">MODEL OC1030 4 DIGIT CLOCK</text>
        <line x1="70" y1="402" x2="272" y2="402" stroke="#000"/>
        <text x="72" y="416" font-family="sans-serif" font-size="8" fill="#111">0.5" Green Color Readouts</text>
        <text x="72" y="428" font-family="sans-serif" font-size="7.5" fill="#444">24 Hour Alarm, 10 Min Snooze, AM/PM</text>
        <rect x="72" y="438" width="65" height="22" fill="#111" rx="2"/>
        <text x="104" y="454" font-family="monospace" font-size="13" font-weight="bold" fill="#22c55e" text-anchor="middle">12:01</text>
        <rect x="150" y="438" width="120" height="22" fill="#000"/>
        <text x="210" y="453" font-family="'Arial Black', sans-serif" font-size="10" fill="#fff" text-anchor="middle">Only $28.50</text>
        <text x="72" y="480" font-family="sans-serif" font-size="7" fill="#555">Orange case, LD8132 tubes, transformer.</text>
      </g>

      <!-- 4. The Most Popular MM5314 Kit (65, 504, 212, 132) -->
      <g>
        <rect x="65" y="504" width="212" height="132" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <rect x="65" y="504" width="212" height="18" fill="#000"/>
        <text x="171" y="517" font-family="'Arial Black', sans-serif" font-size="8.5" fill="#fff" text-anchor="middle">THE MOST POPULAR MM5314 KIT</text>
        <text x="72" y="534" font-family="sans-serif" font-size="8" font-weight="bold" fill="#000">WITH A NEW CASE!!</text>
        <text x="72" y="546" font-family="sans-serif" font-size="7.5" fill="#333">6 Digits Readout • 12/24 Hr • 50/60 Hz</text>
        <!-- 6-digit tube display -->
        <rect x="72" y="554" width="80" height="22" fill="#0f172a" rx="2"/>
        <text x="112" y="570" font-family="monospace" font-size="12" font-weight="bold" fill="#4ade80" text-anchor="middle">12 36 29</text>
        <rect x="156" y="554" width="114" height="22" fill="#000"/>
        <text x="213" y="569" font-family="'Arial Black', sans-serif" font-size="9" fill="#fff" text-anchor="middle">$19.95 ea.</text>
        <text x="72" y="594" font-family="sans-serif" font-size="7" fill="#444">Includes grey case, MM5314 chip, PC</text>
        <text x="72" y="604" font-family="sans-serif" font-size="7" fill="#444">boards, transformer, 6 green 0.3" tubes.</text>
      </g>

      <!-- 5. Model CT7001 (65, 642, 212, 70) -->
      <g>
        <rect x="65" y="642" width="212" height="70" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="171" y="656" font-family="'Arial Black', sans-serif" font-size="9" fill="#000" text-anchor="middle">MODEL CT7001</text>
        <line x1="70" y1="660" x2="272" y2="660" stroke="#000"/>
        <text x="72" y="674" font-family="sans-serif" font-size="7.5" fill="#111">6 Fairchild FND 0.5" Red LED</text>
        <text x="72" y="686" font-family="sans-serif" font-size="7.5" fill="#111">MONTH &amp; DATE • 50/60HZ • ALARM</text>
        <text x="72" y="702" font-family="'Arial Black', sans-serif" font-size="9" fill="#000">Only $28.50 ea. (Without case)</text>
      </g>

      <!-- 6. Computer Keyboards (65, 718, 212, 156) -->
      <g>
        <rect x="65" y="718" width="212" height="156" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <rect x="65" y="718" width="212" height="18" fill="#000"/>
        <text x="171" y="731" font-family="'Arial Black', sans-serif" font-size="9" fill="#fff" text-anchor="middle">COMPUTER KEYBOARDS</text>
        <text x="72" y="748" font-family="sans-serif" font-size="8" font-weight="bold" fill="#000">Standard Teletype Gold Contacts</text>
        <!-- Keyboard drawing -->
        <rect x="72" y="756" width="198" height="34" fill="#e2e8f0" stroke="#000" stroke-width="1"/>
        <line x1="72" y1="767" x2="270" y2="767" stroke="#94a3b8"/>
        <line x1="72" y1="778" x2="270" y2="778" stroke="#94a3b8"/>
        <text x="171" y="806" font-family="'Arial Black', sans-serif" font-size="10" fill="#000" text-anchor="middle">Only $22.50</text>
        <text x="72" y="826" font-family="sans-serif" font-size="8" font-weight="bold" fill="#000">MODEL B ASCII DECODED</text>
        <text x="72" y="838" font-family="sans-serif" font-size="7.5" fill="#333">With TTL logic circuits • SPECIAL $16.50</text>
      </g>


      <!-- ================= COLUMN 2 (MIDDLE) ================= -->
      <!-- 7. Clock Chips (284, 88, 220, 130) -->
      <g>
        <rect x="284" y="88" width="220" height="130" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <rect x="284" y="88" width="220" height="20" fill="#000"/>
        <text x="394" y="102" font-family="'Arial Black', sans-serif" font-size="10" fill="#fff" text-anchor="middle">CLOCK CHIPS</text>
        <text x="290" y="122" font-family="monospace" font-size="8" fill="#111">MM 5311 24 pin 6 digits MUX $4.50</text>
        <text x="290" y="136" font-family="monospace" font-size="8" fill="#111">MM 5313 28 pin 6 digit MUX  $4.00</text>
        <text x="290" y="150" font-family="monospace" font-size="8" fill="#111">MM 5314 24 pin 6 digits 12/24 $3.50</text>
        <text x="290" y="164" font-family="monospace" font-size="8" fill="#111">CT 7001 28 pin Alarm/Date   $6.50</text>
        <text x="290" y="178" font-family="monospace" font-size="8" fill="#111">MM 5316 40 pin Direct LED   $4.50</text>
      </g>

      <!-- 8. Gold Wire Wrap & Solder Tail Sockets (284, 224, 220, 150) -->
      <g>
        <rect x="284" y="224" width="220" height="150" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="394" y="238" font-family="'Arial Black', sans-serif" font-size="8.5" fill="#000" text-anchor="middle">WIRE WRAP &amp; SOLDER SOCKETS</text>
        <line x1="288" y1="243" x2="500" y2="243" stroke="#000"/>
        <text x="290" y="258" font-family="monospace" font-size="7.5" fill="#111">14 pin WW  .36 ea (10/$3.00)</text>
        <text x="290" y="270" font-family="monospace" font-size="7.5" fill="#111">16 pin WW  .50 ea (10/$4.00)</text>
        <text x="290" y="282" font-family="monospace" font-size="7.5" fill="#111">24 pin WW 1.25 ea (10/$10.00)</text>
        <text x="290" y="296" font-family="monospace" font-size="7.5" fill="#111">14 pin ST  .35 ea (10/$2.80)</text>
        <text x="290" y="308" font-family="monospace" font-size="7.5" fill="#111">16 pin ST  .36 ea (10/$3.00)</text>
        <text x="290" y="320" font-family="monospace" font-size="7.5" fill="#111">18 pin ST  .40 ea (10/$3.50)</text>
        <text x="290" y="332" font-family="monospace" font-size="7.5" fill="#111">40 pin ST 1.25 ea (10/$10.00)</text>
        <text x="290" y="346" font-family="sans-serif" font-size="7.5" fill="#444">Standard Xtal Socket .35 each</text>
      </g>

      <!-- Middle Sub-Column Left (W=138): -->
      <!-- 9. 12 VDC Relay (284, 380, 138, 60) -->
      <g>
        <rect x="284" y="380" width="138" height="60" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="353" y="394" font-family="'Arial Black', sans-serif" font-size="8" fill="#000" text-anchor="middle">12 VDC RELAY</text>
        <text x="290" y="408" font-family="sans-serif" font-size="7.5" fill="#111">SPDT 4 amp rating</text>
        <text x="353" y="428" font-family="'Arial Black', sans-serif" font-size="9" fill="#000" text-anchor="middle">$1.25 ea.</text>
      </g>

      <!-- 10. 6V Yuasa Battery (284, 446, 138, 52) -->
      <g>
        <rect x="284" y="446" width="138" height="52" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="353" y="460" font-family="'Arial Black', sans-serif" font-size="7.5" fill="#000" text-anchor="middle">6V YUASA BATTERY</text>
        <text x="290" y="474" font-family="sans-serif" font-size="7" fill="#222">0.6MPH Rechargeable</text>
        <text x="353" y="490" font-family="'Arial Black', sans-serif" font-size="9" fill="#000" text-anchor="middle">$7.50 ea.</text>
      </g>

      <!-- Middle Sub-Column Right (W=142): -->
      <!-- 11. LED Readout (428, 362, 142, 54) -->
      <g>
        <rect x="428" y="362" width="142" height="54" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="499" y="376" font-family="'Arial Black', sans-serif" font-size="8" fill="#000" text-anchor="middle">LED READOUT</text>
        <text x="434" y="390" font-family="monospace" font-size="7" fill="#dc2626">AM PM 12:36 FND503</text>
        <text x="499" y="406" font-family="'Arial Black', sans-serif" font-size="8.5" fill="#000" text-anchor="middle">$8.50 each</text>
      </g>

      <!-- 12. Jumbo LED & LEDs (428, 422, 142, 176) -->
      <g>
        <rect x="428" y="422" width="142" height="176" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="499" y="436" font-family="'Arial Black', sans-serif" font-size="8" fill="#000" text-anchor="middle">JUMBO LED &amp; LEDS</text>
        <!-- 7 segment sketch -->
        <rect x="434" y="442" width="24" height="34" fill="#111" rx="2"/>
        <text x="446" y="466" font-family="monospace" font-size="18" fill="#ef4444" text-anchor="middle">8</text>
        <text x="466" y="454" font-family="sans-serif" font-size="7" font-weight="bold" fill="#000">4 Digit 0.8"</text>
        <text x="466" y="466" font-family="'Arial Black', sans-serif" font-size="8" fill="#000">$3.00 ea</text>
        <line x1="432" y1="482" x2="566" y2="482" stroke="#cbd5e1"/>
        <text x="434" y="496" font-family="monospace" font-size="7" fill="#111">FND 74 Red  $1.50</text>
        <text x="434" y="508" font-family="monospace" font-size="7" fill="#111">MAN 66 Red  $1.50</text>
        <text x="434" y="520" font-family="monospace" font-size="7" fill="#111">DL 747 Red  $2.50</text>
        <text x="434" y="532" font-family="monospace" font-size="7" fill="#111">FND 503 Red $1.60</text>
        <text x="434" y="544" font-family="monospace" font-size="7" fill="#111">FLV 50 Sub  $0.15</text>
        <text x="434" y="556" font-family="monospace" font-size="7" fill="#111">Jumbo Green $0.25</text>
      </g>

      <!-- Middle lower: -->
      <!-- 13. AC Adapters & Transformers (284, 504, 138, 114) -->
      <g>
        <rect x="284" y="504" width="138" height="114" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="353" y="518" font-family="'Arial Black', sans-serif" font-size="7.5" fill="#000" text-anchor="middle">AC ADAPTERS</text>
        <text x="290" y="532" font-family="sans-serif" font-size="7" fill="#222">115V AC Input:</text>
        <text x="290" y="544" font-family="monospace" font-size="7" fill="#111">4.5V, 6V, 9V, 12V $1.85</text>
        <text x="290" y="558" font-family="sans-serif" font-size="7" font-weight="bold" fill="#000">TRANSFORMERS:</text>
        <text x="290" y="570" font-family="monospace" font-size="7" fill="#111">12-0-12V 1A  $2.25</text>
        <text x="290" y="582" font-family="monospace" font-size="7" fill="#111">12V CT 500mA $1.50</text>
      </g>

      <!-- 14. Ni-Cd Batteries Sanyo (284, 624, 138, 56) -->
      <g>
        <rect x="284" y="624" width="138" height="56" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="353" y="638" font-family="'Arial Black', sans-serif" font-size="7.5" fill="#000" text-anchor="middle">NI-CD AA BATTERIES</text>
        <text x="290" y="652" font-family="sans-serif" font-size="7" fill="#222">Sanyo Fast Charge AA</text>
        <text x="353" y="668" font-family="'Arial Black', sans-serif" font-size="8" fill="#000" text-anchor="middle">$1.60 ea (4/$6.00)</text>
      </g>

      <!-- 15. 50 uA Panel Meter (428, 604, 142, 56) -->
      <g>
        <rect x="428" y="604" width="142" height="56" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="499" y="618" font-family="'Arial Black', sans-serif" font-size="7.5" fill="#000" text-anchor="middle">50 uA PANEL METER</text>
        <text x="434" y="632" font-family="sans-serif" font-size="7" fill="#222">Ideal stereo V-U meter 2"x1.5"</text>
        <text x="499" y="648" font-family="'Arial Black', sans-serif" font-size="8.5" fill="#000" text-anchor="middle">Only $3.80 ea.</text>
      </g>

      <!-- 16. Memories (428, 666, 142, 126) -->
      <g>
        <rect x="428" y="666" width="142" height="126" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <rect x="428" y="666" width="142" height="16" fill="#000"/>
        <text x="499" y="678" font-family="'Arial Black', sans-serif" font-size="8" fill="#fff" text-anchor="middle">MEMORIES</text>
        <text x="434" y="696" font-family="monospace" font-size="7" fill="#111">1702A PROM   $13.50</text>
        <text x="434" y="710" font-family="monospace" font-size="7" fill="#111">2102-1 RAM    $2.25</text>
        <text x="434" y="724" font-family="monospace" font-size="7" fill="#111">2107A 4K RAM  $4.50</text>
        <text x="434" y="738" font-family="monospace" font-size="7" fill="#111">4096 Bit Intel $16.50</text>
        <text x="434" y="756" font-family="sans-serif" font-size="6.5" fill="#555">TTL &amp; CMOS price list sent on request</text>
      </g>

      <!-- 17. Auto Alarm Kit (284, 686, 138, 106) -->
      <g>
        <rect x="284" y="686" width="138" height="106" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="353" y="700" font-family="'Arial Black', sans-serif" font-size="8" fill="#000" text-anchor="middle">AUTO ALARM KIT</text>
        <text x="290" y="714" font-family="sans-serif" font-size="7" fill="#222">Electronic intrusion detector</text>
        <text x="290" y="726" font-family="sans-serif" font-size="6.5" fill="#444">5-wire simple hookup.</text>
        <text x="353" y="746" font-family="'Arial Black', sans-serif" font-size="8.5" fill="#000" text-anchor="middle">ONLY $10.95 kit</text>
        <text x="353" y="760" font-family="sans-serif" font-size="7" fill="#444">Completed Unit $19.95</text>
      </g>

      <!-- 18. Computer Grade Capacitor (284, 798, 286, 76) -->
      <g>
        <rect x="284" y="798" width="286" height="76" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="427" y="814" font-family="'Arial Black', sans-serif" font-size="8.5" fill="#000" text-anchor="middle">COMPUTER GRADE CAPACITORS</text>
        <line x1="288" y1="820" x2="566" y2="820" stroke="#000"/>
        <text x="292" y="836" font-family="monospace" font-size="8" fill="#111">15500 MFD 75 VDC ............. $4.50 ea</text>
        <text x="292" y="852" font-family="monospace" font-size="8" fill="#111">5600 MFD 60 V DC ............. $1.75 ea</text>
      </g>


      <!-- ================= COLUMN 3 (RIGHT) ================= -->
      <!-- 19. Electronic Switch Kit (510, 88, 236, 102) -->
      <g>
        <rect x="510" y="88" width="236" height="102" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <rect x="510" y="88" width="236" height="20" fill="#000"/>
        <text x="628" y="102" font-family="'Arial Black', sans-serif" font-size="9" fill="#fff" text-anchor="middle">ELECTRONIC SWITCH KIT</text>
        <text x="516" y="122" font-family="sans-serif" font-size="8" font-weight="bold" fill="#000">CONDENSER TYPE - Touch On / Off</text>
        <text x="516" y="136" font-family="sans-serif" font-size="7.5" fill="#333">Use 7473 IC &amp; 6V relay.</text>
        <text x="628" y="162" font-family="'Arial Black', sans-serif" font-size="11" fill="#000" text-anchor="middle">$5.50 each</text>
      </g>

      <!-- 20. FM Wireless Mic Kit (510, 196, 236, 94) -->
      <g>
        <rect x="510" y="196" width="236" height="94" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="628" y="210" font-family="'Arial Black', sans-serif" font-size="8.5" fill="#000" text-anchor="middle">FM WIRELESS MIC KIT</text>
        <line x1="514" y1="215" x2="742" y2="215" stroke="#000"/>
        <text x="516" y="228" font-family="sans-serif" font-size="7.5" fill="#222">Transmit range up to 500ft. Easy to assemble.</text>
        <text x="628" y="248" font-family="'Arial Black', sans-serif" font-size="10" fill="#000" text-anchor="middle">$4.50 each</text>
        <text x="516" y="268" font-family="sans-serif" font-size="7.5" fill="#333">Sub-Mini Condenser Mic: $2.50 ea.</text>
      </g>

      <!-- 21. Electronic Organ Keyboard (510, 296, 236, 62) -->
      <g>
        <rect x="510" y="296" width="236" height="62" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="628" y="310" font-family="'Arial Black', sans-serif" font-size="8" fill="#000" text-anchor="middle">ELECTRONIC ORGAN KEYBOARD</text>
        <!-- Mini piano keys -->
        <rect x="516" y="316" width="130" height="20" fill="#fff" stroke="#000"/>
        <line x1="528" y1="316" x2="528" y2="336" stroke="#000"/>
        <line x1="540" y1="316" x2="540" y2="336" stroke="#000"/>
        <line x1="552" y1="316" x2="552" y2="336" stroke="#000"/>
        <line x1="564" y1="316" x2="564" y2="336" stroke="#000"/>
        <line x1="576" y1="316" x2="576" y2="336" stroke="#000"/>
        <rect x="522" y="316" width="5" height="12" fill="#000"/>
        <rect x="534" y="316" width="5" height="12" fill="#000"/>
        <rect x="558" y="316" width="5" height="12" fill="#000"/>
        <text x="695" y="330" font-family="'Arial Black', sans-serif" font-size="10" fill="#000" text-anchor="middle">$33.00 ea</text>
        <text x="516" y="348" font-family="sans-serif" font-size="6.5" fill="#444">3 Octaves Full Size • Limited Quantity</text>
      </g>

      <!-- Column 3 Lower (W=170, X=576): -->
      <!-- 22. SAE DIP Switches (576, 362, 170, 86) -->
      <g>
        <rect x="576" y="362" width="170" height="86" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="661" y="376" font-family="'Arial Black', sans-serif" font-size="8" fill="#000" text-anchor="middle">SAE DIP SWITCHES</text>
        <text x="580" y="390" font-family="sans-serif" font-size="7" fill="#222">6/8 Toggle SPDT on 16-pin DIP</text>
        <rect x="580" y="398" width="80" height="16" fill="#0f172a" rx="1"/>
        <text x="620" y="410" font-family="monospace" font-size="8" fill="#fff" text-anchor="middle">1 2 3 4 5 6 7 8</text>
        <text x="661" y="432" font-family="'Arial Black', sans-serif" font-size="9" fill="#000" text-anchor="middle">$1.85 each</text>
      </g>

      <!-- 23. Subminiatures Toggle Switches (576, 454, 170, 56) -->
      <g>
        <rect x="576" y="454" width="170" height="56" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="661" y="468" font-family="'Arial Black', sans-serif" font-size="7.5" fill="#000" text-anchor="middle">TOGGLE SWITCHES</text>
        <text x="580" y="482" font-family="monospace" font-size="7.5" fill="#111">SPDT On-None-On $1.30</text>
        <text x="580" y="496" font-family="monospace" font-size="7.5" fill="#111">DPDT On-None-On $1.50</text>
      </g>

      <!-- 24. EECO BCD Thumbwheel Switches (576, 516, 170, 52) -->
      <g>
        <rect x="576" y="516" width="170" height="52" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="661" y="530" font-family="'Arial Black', sans-serif" font-size="7.5" fill="#000" text-anchor="middle">EECO THUMBWHEEL</text>
        <text x="580" y="544" font-family="monospace" font-size="7" fill="#111">8 pos $1.25 • 10 pos $2.15</text>
        <text x="580" y="556" font-family="monospace" font-size="7" fill="#111">12 positions $2.50 ea</text>
      </g>

      <!-- 25. Quartz Crystals (576, 574, 170, 56) -->
      <g>
        <rect x="576" y="574" width="170" height="56" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="661" y="588" font-family="'Arial Black', sans-serif" font-size="7.5" fill="#000" text-anchor="middle">QUARTZ CRYSTALS</text>
        <text x="580" y="602" font-family="monospace" font-size="7.5" fill="#111">10MHZ Computer $4.25</text>
        <text x="580" y="616" font-family="monospace" font-size="7.5" fill="#111">3.58MHZ Color TV $1.25</text>
      </g>

      <!-- 26. National MM 5369 Osc/Divider (576, 636, 170, 64) -->
      <g>
        <rect x="576" y="636" width="170" height="64" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <text x="661" y="650" font-family="'Arial Black', sans-serif" font-size="7.5" fill="#000" text-anchor="middle">NATIONAL MM 5369</text>
        <text x="580" y="664" font-family="sans-serif" font-size="7" fill="#222">17 Stage 60Hz Divider</text>
        <text x="661" y="684" font-family="'Arial Black', sans-serif" font-size="9" fill="#000" text-anchor="middle">ONLY $2.25 each</text>
      </g>

      <!-- 27. New Alarm Clock Chips Table (576, 706, 170, 168) -->
      <g>
        <rect x="576" y="706" width="170" height="168" fill="#fff" stroke="#000" stroke-width="1.5"/>
        <rect x="576" y="706" width="170" height="18" fill="#000"/>
        <text x="661" y="719" font-family="'Arial Black', sans-serif" font-size="7.5" fill="#fff" text-anchor="middle">ALARM CLOCK CHIPS</text>
        <text x="580" y="736" font-family="sans-serif" font-size="7" font-weight="bold" fill="#000">MM 5375 Series</text>
        <text x="580" y="748" font-family="sans-serif" font-size="6.5" fill="#333">24 pin DIP, Direct LED</text>
        <!-- Mini spec table -->
        <rect x="580" y="756" width="162" height="70" fill="#f8fafc" stroke="#cbd5e1"/>
        <text x="584" y="770" font-family="monospace" font-size="6.5" fill="#111">Pin  MM5375  CT7001</text>
        <text x="584" y="782" font-family="monospace" font-size="6.5" fill="#111">Vdd  -12V    +12V</text>
        <text x="584" y="794" font-family="monospace" font-size="6.5" fill="#111">Vss  GND     GND</text>
        <text x="584" y="806" font-family="monospace" font-size="6.5" fill="#111">Out  Cathode Anode</text>
        <text x="580" y="842" font-family="sans-serif" font-size="6.5" fill="#444">Power failure indication</text>
        <text x="580" y="854" font-family="sans-serif" font-size="6.5" fill="#444">24 hr alarm + snooze</text>
      </g>


      <!-- ================= FOOTER (FULL WIDTH: 65, 880, 681, 110) ================= -->
      <!-- 28. Formula International Masthead & Footer -->
      <g>
        <rect x="65" y="880" width="681" height="110" fill="#ffffff" stroke="#000" stroke-width="2.5"/>
        <!-- Optical concentric circle logo -->
        <circle cx="108" cy="932" r="28" fill="none" stroke="#000" stroke-width="5"/>
        <circle cx="108" cy="932" r="16" fill="none" stroke="#000" stroke-width="4"/>
        <circle cx="108" cy="932" r="6" fill="#000"/>

        <text x="146" y="926" font-family="'Impact', 'Arial Black', sans-serif" font-size="24" letter-spacing="1" fill="#000">FORMULA INTERNATIONAL INC.</text>
        <text x="146" y="944" font-family="'Helvetica Neue', Arial, sans-serif" font-size="9" font-weight="bold" fill="#222">12603 CRENSHAW BOULEVARD • HAWTHORNE, CALIFORNIA 90250</text>
        <text x="146" y="958" font-family="'Helvetica Neue', Arial, sans-serif" font-size="8.5" fill="#444">For more information call (213) 679-5162 • STORE HOURS 10-7 Mon - Sat • 8/76 • Page 123</text>
        <text x="146" y="974" font-family="sans-serif" font-size="7.5" fill="#555">MINIMUM ORDER $10.00 • CA residents add 6% sales tax • Postage &amp; handling $1.50</text>
      </g>
    </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(formulaSvg)}`;
  }

  // 7. DEFAULT AUTHENTIC MAGAZINE EDITORIAL RENDERING FOR OTHER PAGES (4, 6, 7, 8, 126)
  const bg = isAd ? '#fffdf0' : '#faf8f5';
  const border = isAd ? '#fef08a' : '#e2e8f0';

  // 2-column pure SVG typesetter (Column 1: x=50, Column 2: x=415)
  const col1X = 50;
  const col2X = 415;
  const colW = 335;
  const lineH = 20;
  const maxY = 1040;
  const startY = 150;

  let currentCol = 0;
  let curY = startY;
  const editorialSvgNodes: string[] = [];

  // Column divider
  editorialSvgNodes.push(`<line x1="395" y1="135" x2="395" y2="1040" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="2,2"/>`);

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (!para) continue;

    const isHeading = i === 0 || (para.length < 55 && (para === para.toUpperCase() || para.includes(':')));
    const isCoupon = para.includes('NAME _______') || para.includes('Send the following');

    if (isHeading) {
      if (curY + 36 > maxY) {
        if (currentCol === 0) {
          currentCol = 1;
          curY = startY;
        } else {
          break;
        }
      }
      curY += 8;
      const x = currentCol === 0 ? col1X : col2X;
      editorialSvgNodes.push(`<text x="${x}" y="${curY}" font-family="'Helvetica Neue', Arial, sans-serif" font-size="14" font-weight="bold" fill="#0f172a">${escapeHtml(para)}</text>`);
      curY += 22;
      continue;
    }

    if (isCoupon) {
      const x = currentCol === 0 ? col1X : col2X;
      editorialSvgNodes.push(`<rect x="${x}" y="${curY}" width="${colW}" height="75" fill="#ffffff" stroke="#94a3b8" stroke-dasharray="4,4" rx="2"/>`);
      editorialSvgNodes.push(`<text x="${x + 10}" y="${curY + 20}" font-family="monospace" font-size="10" font-weight="bold" fill="#0f172a">ORDER COUPON</text>`);
      editorialSvgNodes.push(`<text x="${x + 10}" y="${curY + 40}" font-family="monospace" font-size="8.5" fill="#475569">NAME: ____________________________</text>`);
      editorialSvgNodes.push(`<text x="${x + 10}" y="${curY + 58}" font-family="monospace" font-size="8.5" fill="#475569">CITY, STATE: _____________________</text>`);
      curY += 85;
      continue;
    }

    const words = para.split(/\s+/);
    const lines: string[] = [];
    let curLine = '';
    const maxChars = 38;
    for (const w of words) {
      if ((curLine ? curLine + ' ' + w : w).length > maxChars) {
        if (curLine) lines.push(curLine);
        curLine = w;
      } else {
        curLine = curLine ? `${curLine} ${w}` : w;
      }
    }
    if (curLine) lines.push(curLine);

    for (const line of lines) {
      if (curY + lineH > maxY) {
        if (currentCol === 0) {
          currentCol = 1;
          curY = startY;
        } else {
          break;
        }
      }
      const x = currentCol === 0 ? col1X : col2X;
      editorialSvgNodes.push(`<text x="${x}" y="${curY}" font-family="Georgia, serif" font-size="13" fill="#1e293b">${escapeHtml(line)}</text>`);
      curY += lineH;
    }
    curY += 10;
  }

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${bg}" stroke="${border}" stroke-width="3"/>

    <!-- Vintage Header Masthead -->
    <rect x="40" y="25" width="720" height="48" fill="#1e293b" rx="4"/>
    <text x="58" y="55" font-family="'Arial Black', Impact, sans-serif" font-size="22" font-weight="900" fill="#f8fafc" letter-spacing="1">BYTE</text>
    <text x="135" y="55" font-family="'Georgia', serif" font-style="italic" font-size="13" fill="#cbd5e1">the small systems journal</text>
    <text x="580" y="46" font-family="sans-serif" font-size="11" fill="#94a3b8">AUGUST 1976 • ISSUE 12</text>
    <text x="580" y="62" font-family="sans-serif" font-size="11" font-weight="bold" fill="#f59e0b">PAGE ${pageNumber} of 132</text>

    ${isAd ? `
      <rect x="520" y="80" width="240" height="26" fill="#f59e0b" rx="3"/>
      <text x="640" y="97" font-family="sans-serif" font-size="11" font-weight="bold" fill="#000000" text-anchor="middle">★ VINTAGE ADVERTISEMENT ★</text>
    ` : ''}

    <!-- Page Title Headline -->
    <text x="50" y="105" font-family="'Helvetica Neue', Arial, sans-serif" font-size="20" font-weight="bold" fill="#0f172a">${escapeHtml(title)}</text>
    <line x1="50" y1="118" x2="750" y2="118" stroke="#94a3b8" stroke-width="1.5"/>

    <!-- Typeset Article Content (Pure SVG) -->
    ${editorialSvgNodes.join('\n')}

    <!-- Page Footer Folio -->
    <line x1="50" y1="1065" x2="750" y2="1065" stroke="#cbd5e1" stroke-width="1"/>
    <text x="50" y="1082" font-family="sans-serif" font-size="10" fill="#64748b">1976 BYTE Publications Inc. • Speech Synthesis &amp; Personal Computing</text>
    <text x="740" y="1082" font-family="sans-serif" font-size="10" font-weight="bold" fill="#334155" text-anchor="end">Page ${pageNumber}</text>
  </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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

    // Generate coordinate-mapped lines / chunks matching layout
    let lines: OcrLine[];

    if (pageNum === 1) {
      // Cover layout calibrated bboxes in natural reading order
      const coverBoxes = [
        { left: 50, top: 35, width: 700, height: 110 }, // BYTE: the small systems journal. August 1976, Issue 12.
        { left: 45, top: 180, width: 710, height: 95 }, // SPEECH SYNTHESIS BY COMPUTER.
        { left: 55, top: 760, width: 690, height: 180 }, // Featured in this issue...
        { left: 55, top: 960, width: 690, height: 40 }, // Cover Art · Printed in USA
      ];

      lines = rawParagraphs.map((text, idx) => {
        const box = coverBoxes[idx % coverBoxes.length];
        return {
          text,
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          confidence: 99,
        };
      });
    } else if (pageNum === 123) {
      // Precise bboxes matching Formula International 28-box ad grid from page_123.jpg in Bridge Rule reading order
      const adBoxes = [
        // Column 1 (Left: x=65, w=212)
        { left: 65, top: 88, width: 212, height: 130 },   // 1. Complete Alarm Clock
        { left: 65, top: 224, width: 212, height: 150 },  // 2. New Clock Kits OC1032
        { left: 65, top: 380, width: 212, height: 118 },  // 3. Model OC1030 4 Digit Clock
        { left: 65, top: 504, width: 212, height: 132 },  // 4. The Most Popular MM5314 Kit
        { left: 65, top: 642, width: 212, height: 70 },   // 5. Model CT7001
        { left: 65, top: 718, width: 212, height: 156 },  // 6. Computer Keyboards

        // Column 2 (Middle: x=284)
        { left: 284, top: 88, width: 220, height: 130 },  // 7. Clock Chips
        { left: 284, top: 224, width: 220, height: 150 }, // 8. Gold Wire Wrap & Solder Tail Sockets
        { left: 284, top: 380, width: 138, height: 60 },  // 9. 12 VDC Relay
        { left: 284, top: 446, width: 138, height: 52 },  // 10. 6V Yuasa Rechargeable Battery
        { left: 428, top: 362, width: 142, height: 54 },  // 11. LED Readout
        { left: 428, top: 422, width: 142, height: 176 }, // 12. Jumbo LED & LEDs
        { left: 284, top: 504, width: 138, height: 114 }, // 13. AC Adapters & Transformers
        { left: 284, top: 624, width: 138, height: 56 },  // 14. Ni-Cd Batteries Sanyo
        { left: 428, top: 604, width: 142, height: 56 },  // 15. 50 uA Panel Meter
        { left: 428, top: 666, width: 142, height: 126 }, // 16. Memories
        { left: 284, top: 686, width: 138, height: 106 }, // 17. Auto Alarm Kit
        { left: 284, top: 798, width: 286, height: 76 },  // 18. Computer Grade Capacitor

        // Column 3 (Right: x=510 / 576)
        { left: 510, top: 88, width: 236, height: 102 },  // 19. Electronic Switch Kit
        { left: 510, top: 196, width: 236, height: 94 },  // 20. FM Wireless Mic Kit
        { left: 510, top: 296, width: 236, height: 62 },  // 21. Electronic Organ Keyboard
        { left: 576, top: 362, width: 170, height: 86 },  // 22. SAE DIP Switches
        { left: 576, top: 454, width: 170, height: 56 },  // 23. Subminiatures Toggle Switches
        { left: 576, top: 516, width: 170, height: 52 },  // 24. EECO BCD Thumbwheel Switches
        { left: 576, top: 574, width: 170, height: 56 },  // 25. Quartz Crystals
        { left: 576, top: 636, width: 170, height: 64 },  // 26. National MM 5369 Osc/Divider
        { left: 576, top: 706, width: 170, height: 168 }, // 27. New Alarm Clock Chips Table

        // Bottom Footer (Full width)
        { left: 65, top: 880, width: 681, height: 110 },  // 28. Formula International Inc.
      ];

      lines = rawParagraphs.map((text, idx) => {
        const box = adBoxes[idx] || adBoxes[idx % adBoxes.length];
        return {
          text,
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          confidence: 98,
        };
      });
    } else if (pageNum === 14) {
      // Letters column layout (right side 2-column flow)
      lines = rawParagraphs.map((text, idx) => {
        const isHeading = idx === 0 || text === 'Letters' || text.startsWith('WHAT WOULD') || text.startsWith('CRITIQUE');
        const top = 220 + idx * 72;
        return {
          text,
          left: 260,
          top,
          width: 480,
          height: isHeading ? 32 : 64,
          confidence: 98,
        };
      });
    } else if (pageNum === 5) {
      // Table of Contents layout
      lines = rawParagraphs.map((text, idx) => {
        const top = 140 + idx * 42;
        return {
          text,
          left: 50,
          top,
          width: 460,
          height: 38,
          confidence: 98,
        };
      });
    } else {
      const topStart = 135;
      const availableHeight = 920;
      const totalParas = Math.max(1, rawParagraphs.length);
      const paraHeight = Math.min(180, Math.max(45, (availableHeight - (totalParas * 12)) / totalParas));

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

    const chunks = pageNum === 123 ? lines : mergeLinesToChunks(lines, 500);
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

  return tagPagesHeaderFooters(pages, '1976_08_BYTE_00-12_Speech_Synthesis.pdf');
}
