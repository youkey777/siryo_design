# Nanobanana Slide Studio

PowerPointを入力し、デザインプロンプトに沿ってNanobanana Pro APIでスライド画像を生成するローカルWebアプリです。

## 動作環境
- Windows
- Microsoft PowerPoint（COM連携に必要）
- Python 3.10+
- Node.js 20+

## 起動方法
- ブラウザ起動: `20260217_アプリ起動.bat`
- アプリ風起動: `20260217_アプリ風起動.bat`
- 起動バッチは `launcher.ps1` を呼び出す薄い構成です。

## 使い方
- 左側で `PowerPoint` と `全体デザインプロンプト` を入力
- 任意で `デザイン参考ファイル` を添付（複数可）
- `デザインを探す` でデザイン参照サイトをポップアップ表示
- `デザインを確認する` で2枚だけ生成（右側に表示）
- 問題なければ `本生成する` で本番生成（右側を上書き表示）
- 本生成後に `修正・再生成` が表示される
- 再生成は指定ページだけ更新され、他ページは保持される
- `一つ戻る` で1ステップ前の生成状態へ戻せる（セッション内のみ）
- `PDF出力` / `PowerPoint出力` で現在表示中の生成結果を書き出せる
- 元資料にロゴがある場合は、ロゴの形状・色・文字を保持する指示で生成

## 開発コマンド
```bash
npm run dev
npm run build
npm start
npm run lint
```

## 生成物
- 生成画像: `data/jobs/<jobId>/outputs/`
- APIレスポンス: `data/jobs/<jobId>/responses/`
- 作業メモJSON: `data/jobs/<jobId>/metadata/job.json`
- エクスポート: `data/jobs/<jobId>/exports/`

## 起動失敗時の確認
- ランチャーログ: `logs/launcher_YYYYMMDD_HHMMSS.log`
- まず `logs/` の最新ログを確認してください。
