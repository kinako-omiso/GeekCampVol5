# capture
スマホ：写真4枚を撮影し、正面選択と「ぬる／けす」のストロークをPCへ送る。PCで生成した方向別Maskを受信し、確認・修正・確定する。ui/ と pipeline/ に分ける。

本番ではスマホでMediaPipeを動かさず、`pipeline/visualHullMask.worker.ts`をPCから使う。撮影した写真は送信失敗時にも保持し、4枚を再送する。
