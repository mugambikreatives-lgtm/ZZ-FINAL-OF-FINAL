const PDFDocument = require('pdfkit');

function generateCVPdf(cvData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28;
    const H = 841.89;
    const SIDEBAR = 185;
    const MAIN = W - SIDEBAR;

    // Sidebar background
    doc.rect(0, 0, SIDEBAR, H).fill('#0D1B2A');

    // Header accent
    doc.rect(SIDEBAR, 0, MAIN, 8).fill('#00BFFF');

    // Name & Title in sidebar
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#00BFFF')
      .text(cvData.fullName || 'Your Name', 15, 40, { width: SIDEBAR - 30, align: 'center' });

    doc.fontSize(10).font('Helvetica').fillColor('#AACCEE')
      .text(cvData.jobTitle || 'Professional Title', 15, doc.y + 4, { width: SIDEBAR - 30, align: 'center' });

    // Divider
    doc.moveTo(25, doc.y + 12).lineTo(SIDEBAR - 25, doc.y + 12).strokeColor('#00BFFF').lineWidth(0.5).stroke();

    // Contact section in sidebar
    let sY = doc.y + 20;
    const sectionLabel = (label, y) => {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#00BFFF')
        .text(label.toUpperCase(), 15, y, { width: SIDEBAR - 30 });
      return doc.y + 4;
    };

    sY = sectionLabel('Contact', sY);

    const contact = [
      { icon: '📞', val: cvData.phone },
      { icon: '✉', val: cvData.email },
      { icon: '📍', val: cvData.location },
      { icon: '🔗', val: cvData.linkedin }
    ].filter(c => c.val);

    contact.forEach(c => {
      if (sY > 750) return;
      doc.fontSize(8).font('Helvetica').fillColor('#CCDDEE')
        .text(`${c.icon} ${c.val}`, 15, sY, { width: SIDEBAR - 20 });
      sY = doc.y + 4;
    });

    sY += 10;

    // Skills in sidebar
    if (cvData.skills && cvData.skills.length) {
      sY = sectionLabel('Skills', sY);
      doc.moveTo(25, sY - 2).lineTo(SIDEBAR - 25, sY - 2).strokeColor('#00BFFF').lineWidth(0.3).stroke();
      sY += 2;

      const skills = Array.isArray(cvData.skills) ? cvData.skills : cvData.skills.split(',').map(s => s.trim());
      skills.forEach(skill => {
        if (!skill || sY > 780) return;
        doc.circle(20, sY + 3.5, 2).fill('#00BFFF');
        doc.fontSize(8).font('Helvetica').fillColor('#CCDDEE')
          .text(skill, 28, sY, { width: SIDEBAR - 40 });
        sY = doc.y + 3;
      });
    }

    // Languages
    if (cvData.languages) {
      sY += 8;
      sY = sectionLabel('Languages', sY);
      doc.moveTo(25, sY - 2).lineTo(SIDEBAR - 25, sY - 2).strokeColor('#00BFFF').lineWidth(0.3).stroke();
      sY += 2;
      doc.fontSize(8).font('Helvetica').fillColor('#CCDDEE')
        .text(cvData.languages, 15, sY, { width: SIDEBAR - 30 });
      sY = doc.y + 4;
    }

    // Main content area
    let mY = 30;
    const mX = SIDEBAR + 20;
    const mW = MAIN - 40;

    const mainSection = (title) => {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0D1B2A')
        .text(title.toUpperCase(), mX, mY, { width: mW });
      mY = doc.y + 2;
      doc.moveTo(mX, mY).lineTo(mX + mW, mY).strokeColor('#00BFFF').lineWidth(1).stroke();
      mY += 8;
    };

    // Professional Summary
    if (cvData.summary) {
      mainSection('Professional Summary');
      doc.fontSize(9).font('Helvetica').fillColor('#333')
        .text(cvData.summary, mX, mY, { width: mW });
      mY = doc.y + 16;
    }

    // Experience
    if (cvData.experience && cvData.experience.length) {
      mainSection('Work Experience');
      cvData.experience.forEach(exp => {
        if (!exp.title) return;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#0D1B2A')
          .text(exp.title, mX, mY, { width: mW * 0.65, continued: true });
        doc.fontSize(9).font('Helvetica').fillColor('#00BFFF')
          .text(exp.duration || '', { align: 'right', width: mW * 0.35 });
        mY = doc.y;

        if (exp.company) {
          doc.fontSize(9).font('Helvetica-Oblique').fillColor('#555')
            .text(exp.company + (exp.location ? ` | ${exp.location}` : ''), mX, mY, { width: mW });
          mY = doc.y + 3;
        }

        if (exp.description) {
          doc.fontSize(8.5).font('Helvetica').fillColor('#444')
            .text(exp.description, mX + 5, mY, { width: mW - 5 });
          mY = doc.y + 10;
        }
      });
      mY += 6;
    }

    // Education
    if (cvData.education && cvData.education.length) {
      mainSection('Education');
      cvData.education.forEach(edu => {
        if (!edu.degree) return;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#0D1B2A')
          .text(edu.degree, mX, mY, { width: mW * 0.65, continued: true });
        doc.fontSize(9).font('Helvetica').fillColor('#00BFFF')
          .text(edu.year || '', { align: 'right', width: mW * 0.35 });
        mY = doc.y;

        if (edu.institution) {
          doc.fontSize(9).font('Helvetica-Oblique').fillColor('#555')
            .text(edu.institution, mX, mY, { width: mW });
          mY = doc.y + 10;
        }
      });
      mY += 6;
    }

    // Certifications
    if (cvData.certifications) {
      mainSection('Certifications');
      doc.fontSize(9).font('Helvetica').fillColor('#444')
        .text(cvData.certifications, mX, mY, { width: mW });
      mY = doc.y + 16;
    }

    // Footer
    doc.rect(SIDEBAR, H - 25, MAIN, 25).fill('#F0F4F8');
    doc.fontSize(7).font('Helvetica').fillColor('#999')
      .text('Generated by Zenith Zoom · zenithzoom.com', mX, H - 16, { width: mW, align: 'center' });

    doc.end();
  });
}

module.exports = { generateCVPdf };
