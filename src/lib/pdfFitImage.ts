import jsPDF from 'jspdf';

type JsPdfDoc = InstanceType<typeof jsPDF>;

/** Čeka učitavanje slika u DOM-u pre html2canvas (logo/QR spolja). */
export function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = root.querySelectorAll('img');
  return Promise.all(
    Array.from(imgs).map(
      (img) =>
        img.complete && img.naturalHeight > 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              const done = () => resolve();
              img.addEventListener('load', done, { once: true });
              img.addEventListener('error', done, { once: true });
              setTimeout(done, 12000);
            }),
    ),
  ).then(() => undefined);
}

/**
 * Doda PNG na trenutnu A4 stranicu: proporcije zadržane, ceo sadržaj stane,
 * centrirano u okviru margina (rešava odsečen donji deo).
 */
export function addPngImageFitPageCentered(
  pdf: JsPdfDoc,
  imgData: string,
  marginMm = 10,
): void {
  const imgProps = pdf.getImageProperties(imgData);
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const maxW = pageW - 2 * marginMm;
  const maxH = pageH - 2 * marginMm;
  const iw = imgProps.width;
  const ih = imgProps.height;
  let drawW = maxW;
  let drawH = (ih * drawW) / iw;
  if (drawH > maxH) {
    drawH = maxH;
    drawW = (iw * drawH) / ih;
  }
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;
  pdf.addImage(imgData, 'PNG', x, y, drawW, drawH);
}
