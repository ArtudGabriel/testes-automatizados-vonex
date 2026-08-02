import { onlyDigits, sameNumber } from './phone.util';

describe('onlyDigits', () => {
  it('tira formatação e o sufixo do JID', () => {
    expect(onlyDigits('+55 (11) 99999-8888')).toBe('5511999998888');
    expect(onlyDigits('5511999998888@s.whatsapp.net')).toBe('5511999998888');
  });
});

describe('sameNumber', () => {
  it('ignora formatação', () => {
    expect(sameNumber('+55 11 99999-8888', '5511999998888')).toBe(true);
  });

  it('tolera o nono dígito', () => {
    expect(sameNumber('5511999998888', '551199998888')).toBe(true);
  });

  it('separa números diferentes', () => {
    expect(sameNumber('5511999998888', '5511977776666')).toBe(false);
  });

  it('não casa vazio com coisa nenhuma', () => {
    expect(sameNumber('', '5511999998888')).toBe(false);
    expect(sameNumber('5511999998888', '')).toBe(false);
  });

  it('número curto só casa exato — sem chutar sufixo', () => {
    expect(sameNumber('99998888', '5511999998888')).toBe(false);
  });
});
