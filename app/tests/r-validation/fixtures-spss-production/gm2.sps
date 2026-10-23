GET DATA /TYPE=TXT
  /FILE='C:\path\to\gm\gm2.csv'
  /DELIMITERS="," /FIRSTCASE=2
  /VARIABLES=a F8.0 b F8.0 c F8.0 d F8.0 e F8.0.
* Six decimals so the grouped median is not rounded away.
FORMATS a b c d e (F14.6).
SUMMARIZE /TABLES=a b c d e /FORMAT=NOLIST TOTAL /CELLS=COUNT MEDIAN GMEDIAN.
