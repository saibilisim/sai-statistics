* case-summaries.sps - reference values for test-case-summaries-spss-2026-08.R
* and test-grouped-median-2026-08.R, on the synthetic fixture written by
* make-case-summaries.R. Paths are placeholders: see README.md.
SET UNICODE=ON.

* 1. The 100-case fixture, every statistic the tests check.
GET DATA /TYPE=TXT
  /FILE='C:\path\to\sai-statistics\app\tests\r-validation\fixtures-spss-case-summaries-100.csv'
  /ENCODING='UTF8'
  /ARRANGEMENT=DELIMITED /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=cinsiyet F1.0 tani_yili F4.0 ad_soyad A40 kayit_no F8.0.
* Six decimals so nothing the tests compare is rounded away.
FORMATS tani_yili kayit_no (F14.6).
SUMMARIZE
  /TABLES=tani_yili ad_soyad kayit_no BY cinsiyet
  /FORMAT=NOLIST TOTAL
  /MISSING=VARIABLE
  /CELLS=COUNT MEAN MEDIAN SEMEAN SUM MIN MAX RANGE FIRST LAST STDDEV VAR
         KURT SEKURT SKEW SESKEW GMEDIAN.

* 2. The 309-case file with a 100-case limit: how many cases per group survive.
GET DATA /TYPE=TXT
  /FILE='C:\path\to\case-summaries-309.csv'
  /ENCODING='UTF8'
  /ARRANGEMENT=DELIMITED /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=cinsiyet F1.0 tani_yili F4.0 ad_soyad A40 kayit_no F8.0.
SUMMARIZE
  /TABLES=tani_yili BY cinsiyet
  /FORMAT=LIST LIMIT=100 TOTAL
  /MISSING=VARIABLE
  /CELLS=COUNT.
