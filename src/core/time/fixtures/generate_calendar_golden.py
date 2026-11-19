"""暦の換算の正解値（golden data）を作る。T1-02、設計書 §5.1・D-29。

作り方（リポジトリの根で実行する）:

    <仮想環境>/bin/python src/core/time/fixtures/generate_calendar_golden.py
    npx prettier --write src/core/time/fixtures/calendar-golden.json

<仮想環境> は、`python3 -m venv <場所>` で作り、`<場所>/bin/pip install convertdate` で
convertdate を入れたもの。システムの python3 に convertdate が無くても動く。

【なぜ】TypeScript の実装（Reingold & Dershowitz の算法）とは別の実装（convertdate）で
正解値を作り、実装の取り違えを見つける。乱数は種を固定し、何度作っても同じ結果にする。

出力の形（calendar-golden.json）:
  gregorian, hijri: [JDN, 年, 月, 日] の配列。JDN はユリウス通日の整数（日の正午を指す番号）。
  hijriLeapYears: ヒジュラ暦の閏年（-50〜100 年）
  hijriMonthLengths: [年, 月, 日数]（1〜60 年のすべての月）
年は天文学的な数え方（紀元前 1 年 ＝ 0 年）。
"""
import json
import math
import random
from pathlib import Path

from convertdate import gregorian, islamic

# 【なぜ】convertdate の to_jd は「日の始まり（真夜中）」の JD（x.5）を返す。
# JDN は、その日の正午を含む整数なので、0.5 を足して切り捨てる。
def jdn_of(jd):
    return math.floor(jd + 0.5)


def gregorian_row(jdn):
    y, m, d = gregorian.from_jd(jdn - 0.5)
    assert jdn_of(gregorian.to_jd(y, m, d)) == jdn
    return [jdn, y, m, d]


def hijri_row(jdn):
    y, m, d = islamic.from_jd(jdn - 0.5)
    assert jdn_of(islamic.to_jd(y, m, d)) == jdn
    return [jdn, y, m, d]


def window(fn, start_jdn, days):
    return [fn(j) for j in range(start_jdn, start_jdn + days)]


rng = random.Random(20260101)

# --- グレゴリオ暦 ---
g0 = jdn_of(gregorian.to_jd(-3, 1, 1))
greg = window(gregorian_row, g0, 366 * 7)  # 紀元前 4 年（-3）〜 紀元 3 年（紀元前 1 年 ＝ 0 年を含む）
greg += window(gregorian_row, jdn_of(gregorian.to_jd(1582, 9, 20)), 30)  # 1582 年 10 月の改暦の前後
greg += window(gregorian_row, jdn_of(gregorian.to_jd(1899, 12, 25)), 400)  # 1900 年（平年）
greg += window(gregorian_row, jdn_of(gregorian.to_jd(1999, 12, 25)), 450)  # 2000 年（閏年）
greg += window(gregorian_row, jdn_of(gregorian.to_jd(2099, 12, 25)), 100)  # 2100 年（平年）
greg += window(gregorian_row, jdn_of(gregorian.to_jd(-101, 2, 20)), 20)  # -101 年（平年）
greg += window(gregorian_row, jdn_of(gregorian.to_jd(-400, 2, 20)), 20)  # -400 年（閏年）
greg += window(gregorian_row, jdn_of(gregorian.to_jd(1640, 12, 20)), 20)  # 1640 年 12 月
lo, hi = jdn_of(gregorian.to_jd(-4000, 1, 1)), jdn_of(gregorian.to_jd(4000, 12, 31))
greg += [gregorian_row(rng.randint(lo, hi)) for _ in range(1500)]

# --- ヒジュラ暦 ---
h0 = jdn_of(islamic.to_jd(-2, 1, 1))
hij = window(hijri_row, h0, 354 * 6)  # -2 年〜 3 年（紀元 1 年 1 月 1 日 ＝ JDN 1948440 をまたぐ）
hij += window(hijri_row, jdn_of(islamic.to_jd(1049, 11, 1)), 354 * 2 + 30)  # 1050 年の前後
hij += window(hijri_row, jdn_of(islamic.to_jd(1050, 9, 1)), 40)  # 1050 年ラマダーン
# 30 年周期の閏年の境を、すべての年の末尾 3 日と初日で確かめる
for y in range(1, 61):
    last = jdn_of(islamic.to_jd(y + 1, 1, 1))
    hij += [hijri_row(last - 3 + k) for k in range(6)]
lo, hi = jdn_of(islamic.to_jd(-100, 1, 1)), jdn_of(islamic.to_jd(2000, 12, 29))
hij += [hijri_row(rng.randint(lo, hi)) for _ in range(1500)]

leap = [y for y in range(-50, 101) if islamic.leap(y)]
lengths = [[y, m, islamic.month_length(y, m)] for y in range(1, 61) for m in range(1, 13)]

out = {
    "gregorian": greg,
    "hijri": hij,
    "hijriLeapYears": leap,
    "hijriMonthLengths": lengths,
}
path = Path(__file__).with_name("calendar-golden.json")
path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(path, len(greg), len(hij), len(leap), len(lengths))
