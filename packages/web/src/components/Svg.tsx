type Props = {
  // `?raw` で読み込んだ SVG の文字列
  markup: string
  className?: string
  // アイコンだけで意味を伝えるときに付ける。無ければ飾りとして読み上げない
  label?: string
}

/**
 * docs/design/assets の SVG をインラインで描く。
 * アイコンは currentColor で描かれていて <img> だと黒になるので、CSS の color で色を変えられるように埋め込む。
 * 自分たちの素材ファイルだけを渡すこと（外から来た文字列は渡さない）。
 */
export function Svg({ markup, className, label }: Props) {
  return (
    <span
      className={className ? `svg ${className}` : 'svg'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
