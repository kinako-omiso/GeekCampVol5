# peer

/dev/peer：PeerJS の疎通確認ページ。PCから送る /dev/peer?host=... のリンクでは Issue #4 のスマホ検証画面を表示する。

スマホ検証画面は既存の JoinScreen と PadScreen を使い、基準姿勢から補正した傾きを30Hzで送り、A/B の有効な押下を送る。通信が切れると再接続画面に戻る。
