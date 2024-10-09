const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const PORT = process.env.PORT || 3000;
const nodemailer = require('nodemailer');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });


dotenv.config();

const app = express();
const { exec } = require('child_process');
// Configurações
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Conectando ao MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log('Conectado ao MongoDB');
}).catch((err) => {
    console.error('Erro ao conectar ao MongoDB:', err);
});

const userSchema = new mongoose.Schema({
    nomeDaEmpresa: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    imagem: { 
        data: Buffer, 
        contentType: String 
    }
});

const User = mongoose.model('User', userSchema);


function runCameraScript() {
    exec('python camera/camera.py', (error, stdout, stderr) => {
        if (error) {
            console.error(`Erro ao executar o script: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Erro: ${stderr}`);
            return;
        }
        console.log(`Saída do script Python: ${stdout}`);
    });
}

// Executa o script Python assim que o servidor é iniciado
runCameraScript();

function authenticateToken(req, res, next) {
    const token = req.header('token');
    if (!token) return res.status(401).json({ error: 'Acesso negado' });
    try {
        const verified = jwt.verify(token, process.env.TOKEN_SECRET || 'secretkey');
        req.user = verified;
        next();
    } catch (error) {
        res.status(400).json({ error: 'Token inválido' });
    }
}



// Definindo o modelo de construção
const construcaoSchema = new mongoose.Schema({
    id: Number,
    nome: String,
    latitude: Number,
    longitude: Number,
    estoque: [
        {
            item: String,
            quantidade: Number,
        },
    ],
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const Construcao = mongoose.model('Construcao', construcaoSchema);

// Endpoint para obter todas as construções
app.get('/construcoes', authenticateToken, async (req, res) => {
    try {
        const construcoes = await Construcao.find({ userId: req.user._id });
        res.send(construcoes);
    } catch (error) {
        res.status(500).send('Erro ao obter as construções.');
    }
});

app.get('/getUserImage', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user || !user.imagem || !user.imagem.data) {
            return res.status(404).json({ error: 'Nenhuma imagem encontrada para o usuário' });
        }

        res.set('Content-Type', user.imagem.contentType);
        res.send(user.imagem.data);
    } catch (error) {
        console.error('Erro ao carregar a imagem do usuário:', error);
        res.status(500).json({ error: 'Erro ao carregar imagem' });
    }
});


// Configure o nodemailer para enviar e-mails
const transporter = nodemailer.createTransport({
    service: 'gmail', // Ou outro serviço de email que você use
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Endpoint para obter uma construção por ID
app.get('/construcoes/:id', async (req, res) => {
    const construcaoId = req.params.id;
    try {
        const construcao = await Construcao.findOne({ id: construcaoId });
        if (construcao) {
            res.send(construcao);
        } else {
            res.status(404).send('Construção não encontrada.');
        }
    } catch (error) {
        res.status(500).send('Erro ao obter a construção.');
    }
});

// Endpoint para solicitar recuperação de senha
app.post('/esqueci-senha', async (req, res) => {
    const { email } = req.body;
    try {
        // Check if the email exists
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'E-mail não encontrado' });
        }

        // Generate a password reset token (e.g., using JWT or another method)
        const token = jwt.sign({ _id: user._id }, process.env.TOKEN_SECRET || 'secretkey', { expiresIn: '1h' });

        // Send the reset email
        const resetLink = `http://localhost:3000/telaDeRedefinirSenha.html?token=${token}`;
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Recuperação de Senha - Nexus',
            html: `<p>Clique no link abaixo para redefinir sua senha:</p><a href="${resetLink}">Redefinir Senha</a>`
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: 'E-mail de recuperação enviado!' });
    } catch (error) {
        console.error('Erro ao enviar e-mail:', error);
        res.status(500).json({ error: 'Erro ao enviar e-mail de recuperação' });
    }
});

app.post('/upload', authenticateToken, upload.single('imagem'), async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Atualiza a imagem do usuário
        user.imagem = {
            data: req.file.buffer,
            contentType: req.file.mimetype
        };

        await user.save();
        res.status(200).json({ message: 'Imagem atualizada com sucesso!' });
    } catch (error) {
        console.error('Erro ao salvar a imagem:', error);
        res.status(500).json({ error: 'Erro ao salvar imagem' });
    }
});


app.post('/redefinir-senha', async (req, res) => {
    const { token, novaSenha } = req.body;
    try {
        // Verifica o token e recupera o ID do usuário
        const decoded = jwt.verify(token, process.env.TOKEN_SECRET || 'secretkey');
        const user = await User.findById(decoded._id);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Atualiza a senha do usuário
        const hashedPassword = await bcrypt.hash(novaSenha, 10);
        user.senha = hashedPassword;
        await user.save();

        res.json({ message: 'Senha redefinida com sucesso!' });
    } catch (error) {
        console.error('Erro ao redefinir senha:', error);
        res.status(400).json({ error: 'Token inválido ou expirado' });
    }
});


// Endpoint para adicionar uma nova construção
app.post('/construcoes', authenticateToken, async (req, res) => {
    const novaConstrucao = req.body;
    novaConstrucao.userId = req.user._id; // Associa a construção ao usuário logado
    try {
        const construcao = new Construcao(novaConstrucao);
        await construcao.save();
        res.send(construcao);
    } catch (error) {
        res.status(500).send('Erro ao salvar a construção.');
    }
});

// Endpoint para atualizar o estoque de uma construção
app.put('/construcoes/:id/estoque', async (req, res) => {
    const construcaoId = req.params.id;
    const novoEstoque = req.body;
    try {
        const construcao = await Construcao.findOneAndUpdate(
            { id: construcaoId },
            { $set: { estoque: novoEstoque } },
            { new: true }
        );
        if (construcao) {
            res.send(construcao);
        } else {
            res.status(404).send('Construção não encontrada.');
        }
    } catch (error) {
        res.status(500).send('Erro ao atualizar o estoque.');
    }
});

// Endpoint para remover uma construção pelo ID
app.delete('/construcoes/:id', async (req, res) => {
    const construcaoId = req.params.id;
    try {
        const construcao = await Construcao.findOneAndDelete({ id: construcaoId });
        if (construcao) {
            res.send({ message: 'Construção removida com sucesso.' });
        } else {
            res.status(404).send('Construção não encontrada.');
        }
    } catch (error) {
        res.status(500).send('Erro ao remover a construção.');
    }
});

app.post('/register', async (req, res) => {
    const { nomeDaEmpresa, email, senha } = req.body;
    try {
        // Verificar se o email já está em uso
        const emailExistente = await User.findOne({ email });
        if (emailExistente) {
            return res.status(400).json({ error: 'E-mail já cadastrado.' });
        }

        // Hash da senha
        const hashedPassword = await bcrypt.hash(senha, 10);

        // Criar novo usuário
        const user = new User({
            nomeDaEmpresa,
            email,
            senha: hashedPassword,
        });
        await user.save();
        res.status(201).json({ message: 'Usuário registrado com sucesso' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao registrar usuário' });
    }
});

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        // Encontrar usuário pelo email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'E-mail ou senha incorretos' });
        }

        // Comparar a senha
        const validPassword = await bcrypt.compare(senha, user.senha);
        if (!validPassword) {
            return res.status(400).json({ error: 'E-mail ou senha incorretos' });
        }

        // Criar e atribuir um token
        const token = jwt.sign({ _id: user._id }, process.env.TOKEN_SECRET || 'secretkey', { expiresIn: '1h' });

        // Retornar o token e uma mensagem de sucesso no formato JSON
        res.json({ message: 'Logado com sucesso', token });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao fazer login' });
    }
});




// Iniciando o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
