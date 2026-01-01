const Groq = require('groq-sdk');
const Busboy = require('busboy');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Aquí Netlify inyectará tu clave secreta automáticamente
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  try {
    const fileBuffer = await parseMultipart(event);
    
    // Límite de seguridad: 4.5MB para evitar errores en capa gratuita
    if (fileBuffer.length > 4.5 * 1024 * 1024) {
      return { statusCode: 400, body: JSON.stringify({ error: "El archivo es muy pesado (Máx 4.5MB)." }) };
    }

    // 1. Enviar audio a Whisper (Groq)
    const transcription = await groq.audio.transcriptions.create({
      file: await toFile(fileBuffer, 'audio.mp3'),
      model: "whisper-large-v3",
      language: "es"
    });

    // 2. Enviar texto a Llama (Groq) para estructurar
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Actúa como un sistema automatizado.
          REGLAS:
          1. Estructura usando etiquetas: [VERSO 1], [VERSO 2], [CORO 1], [CORO 2], [PUENTE], [OUTRO]. 
          2. NO uses Pre-Coro. 
          3. Elimina saludos, despedidas, y cualquier texto que no sea la letra.
          4. Devuelve SOLO la letra.
          
          Texto Crudo: "${transcription.text}"`
        }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ letra: completion.choices[0].message.content })
    };

  } catch (error) {
    console.error("Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Error procesando la solicitud." }) };
  }
};

// Funciones auxiliares para leer el archivo subido
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: event.headers });
    let fileBuffer = [];
    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      file.on('data', (data) => fileBuffer.push(data));
      file.on('end', () => resolve(Buffer.concat(fileBuffer)));
    });
    busboy.on('error', reject);
    busboy.write(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
    busboy.end();
  });
}

async function toFile(buffer, filename) {
  const { File } = await import('buffer');
  return new File([buffer], filename, { type: 'audio/mpeg' });
}