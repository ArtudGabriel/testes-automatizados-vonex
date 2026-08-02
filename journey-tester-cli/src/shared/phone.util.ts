/** Só dígitos: a plataforma pode devolver `+55 11 99999-9999` ou o JID do Baileys. */
export function onlyDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Mesmo número, tolerando formatação e o nono dígito.
 *
 * Existe porque o sink é compartilhado entre cenários simultâneos e o
 * roteamento é pelo destinatário: comparar string crua faria a mensagem cair no
 * cenário errado só porque a plataforma devolveu o número formatado.
 *
 * Compara os 8 dígitos finais quando o resto não bate — é o que sobrevive à
 * variação de DDI e do nono dígito. Dois contatos de teste que só se diferenciem
 * além disso seriam confundidos; na prática eles diferem no final.
 */
export function sameNumber(a: string, b: string): boolean {
  const left = onlyDigits(a);
  const right = onlyDigits(b);

  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 10 || right.length < 10) return false;

  return left.slice(-8) === right.slice(-8);
}
