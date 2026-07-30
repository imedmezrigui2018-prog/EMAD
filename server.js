const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); 
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const supabaseUrl = 'https://swyjmfcpferyzqaectmw.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY; 

const supabase = createClient(supabaseUrl, supabaseKey);

// --- 🔒 Vérification des droits : consulte la colonne de rôle demandée pour ce matricule ---
async function estAdmin(matricule, colonneRole) {
    if (!matricule) return false;
    try {
        const { data, error } = await supabase
            .from('ouvriers')
            .select(colonneRole)
            .eq('matricule', matricule)
            .single();
        if (error || !data) return false;
        return data[colonneRole] === 'admin';
    } catch (e) {
        return false;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/api/login', async (req, res) => {
    const { matricule, mot_de_passe } = req.body;
    try {
        const { data, error } = await supabase
            .from('ouvriers')
            .select('*')
            .eq('matricule', matricule)
            .eq('mot_de_passe', mot_de_passe);

        if (error) throw error;
        if (data && data.length > 0) {
            res.json({ success: true, message: "Connexion réussie", user: data[0] });
        } else {
            res.json({ success: false, message: "Matricule ou mot de passe incorrect." });
        }
    } catch (error) {
        console.error("Erreur serveur :", error);
        res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});

app.get('/api/boards', async (req, res) => {
    try {
        const { data: boards, error } = await supabase.from('bretbau').select('*');
        if (error) throw error;
        res.json({ success: true, boards });
    } catch (error) {
        console.error("Erreur récupération boards :", error);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.get('/api/board/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { data: board, error } = await supabase
            .from('bretbau')
            .select('*')
            .eq('id', id)
            .single();

        if (error) return res.status(400).json({ success: false, message: error.message });
        res.json({ success: true, board });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.post('/api/board/valider-preventif', async (req, res) => {
    const { board_id, ajoute_par } = req.body;
    try {
        const { data: board, error: fetchErr } = await supabase
            .from('bretbau')
            .select('frequence_preventive_jours')
            .eq('id', board_id)
            .single();

        if (fetchErr || !board) return res.status(400).json({ success: false, message: "Bretbau introuvable." });

        const intervalleJours = board.frequence_preventive_jours || 30;
        const nouvelleDate = new Date();
        nouvelleDate.setDate(nouvelleDate.getDate() + intervalleJours);
        const dateFormatted = nouvelleDate.toISOString().split('T')[0];

        const { error: updateErr } = await supabase
            .from('bretbau')
            .update({ date_preventive: dateFormatted, dernier_preventif_par: ajoute_par })
            .eq('id', board_id);

        if (updateErr) return res.status(400).json({ success: false, message: updateErr.message });

        res.json({ success: true, message: "Maintenance préventive validée !", nouvelle_date: dateFormatted });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.get('/api/changements/:board_id', async (req, res) => {
    const boardId = req.params.board_id;
    try {
        const { data, error } = await supabase
            .from('changement')
            .select('*')
            .eq('bretbau_id', boardId)
            .order('date_changement', { ascending: false });

        if (error) throw error;
        res.json({ success: true, changements: data });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur lors de la récupération." });
    }
});

// ROUTE : Ajouter un nouveau changement — réservé à role_changement = admin
app.post('/api/changements', async (req, res) => {
    const { id, bretbau_id, date_changement, rapport, titre, ajoute_par } = req.body;
    try {
        const autorise = await estAdmin(ajoute_par, 'role_changement');
        if (!autorise) {
            return res.status(403).json({ success: false, message: "Droits insuffisants pour ajouter un changement." });
        }

        const { data, error } = await supabase
            .from('changement')
            .insert([{ id, bretbau_id, date_changement, rapport, titre, ajoute_par }]);

        if (error) throw error;
        res.json({ success: true, message: "Changement ajouté avec succès." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur lors de l'ajout." });
    }
});

app.post('/api/changements/upload', upload.single('fichier'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "Aucun fichier reçu." });

    const typesAutorises = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!typesAutorises.includes(req.file.mimetype)) {
        return res.status(400).json({ success: false, message: "Seuls les fichiers PDF, JPG ou PNG sont acceptés." });
    }

    try {
        const nomFichier = `${Date.now()}-${req.file.originalname}`;
        const { error: uploadErr } = await supabase.storage
            .from('rapports')
            .upload(nomFichier, req.file.buffer, { contentType: req.file.mimetype });

        if (uploadErr) return res.status(400).json({ success: false, message: uploadErr.message });

        const { data: urlData } = supabase.storage.from('rapports').getPublicUrl(nomFichier);
        res.json({ success: true, url: urlData.publicUrl });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur serveur lors de l'upload." });
    }
});

app.get('/api/composants/:board_id', async (req, res) => {
    const boardId = req.params.board_id;
    try {
        const { data, error } = await supabase
            .from('composant')
            .select('*')
            .eq('bretbau_id', boardId);

        if (error) throw error;
        res.json({ success: true, composants: data });
    } catch (error) {
        console.error("Erreur serveur composants :", error);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

app.post('/api/composants/defaillance', async (req, res) => {
    const { composant_id, type_intervention, temps_darret_ajout, ajoute_par } = req.body;
    try {
        const { data: compList, error: fetchErr } = await supabase
            .from('composant')
            .select('*')
            .eq('id', composant_id);

        if (fetchErr) return res.status(400).json({ success: false, message: "Erreur lecture : " + fetchErr.message });
        if (!compList || compList.length === 0) return res.status(400).json({ success: false, message: "Composant introuvable." });

        const comp = compList[0];
        let newDefautCount = Number(comp.defaut_count || 0) + 1;
        let newModifCount = Number(comp.modification_count || 0);
        let newReplaceCount = Number(comp.replacement_count || 0);
        let newTempsDarret = Number(comp.temps_darret || 0) + Number(temps_darret_ajout || 0);

        if (type_intervention === 'modification') newModifCount += 1;
        else newReplaceCount += 1;

        const now = new Date();
        const currentMonthInt = parseInt(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`, 10);
        let newDefautsMois = (Number(comp.dernier_mois_enregistre) === currentMonthInt) ? Number(comp.defauts_mois_actuel || 0) + 1 : 1;

        const { error: updateErr } = await supabase
            .from('composant')
            .update({
                defaut_count: newDefautCount,
                modification_count: newModifCount,
                replacement_count: newReplaceCount,
                temps_darret: newTempsDarret,
                defauts_mois_actuel: newDefautsMois,
                dernier_mois_enregistre: currentMonthInt,
                ajoute_par: ajoute_par 
            })
            .eq('id', comp.id);

        if (updateErr) return res.status(400).json({ success: false, message: "Erreur écriture : " + updateErr.message });

        const { error: logErr } = await supabase
            .from('defaillance_log')
            .insert([{
                composant_id: comp.id,
                type_intervention,
                temps_darret: Number(temps_darret_ajout || 0),
                ajoute_par
            }]);

        if (logErr) console.error("Erreur log défaillance :", logErr.message);

        res.json({
            success: true,
            message: "Défaillance enregistrée avec succès !",
            logError: logErr ? logErr.message : null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur inattendue du serveur." });
    }
});

app.get('/api/composants/:id/defaillances-mois', async (req, res) => {
    const { id } = req.params;
    try {
        const now = new Date();
        const debutMois = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const { data, error } = await supabase
            .from('defaillance_log')
            .select('ajoute_par')
            .eq('composant_id', id)
            .gte('date_creation', debutMois);

        if (error) throw error;

        const compteurs = {};
        (data || []).forEach(row => {
            const matricule = row.ajoute_par || 'Inconnu';
            compteurs[matricule] = (compteurs[matricule] || 0) + 1;
        });

        const repartition = Object.entries(compteurs).map(([ajoute_par, count]) => ({ ajoute_par, count }));

        res.json({ success: true, repartition });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

// ROUTE : Ajouter un composant — réservé à role_composant = admin
app.post('/api/composants', async (req, res) => {
    const { id, bretbau_id, nom, ajoute_par } = req.body;
    try {
        const autorise = await estAdmin(ajoute_par, 'role_composant');
        if (!autorise) {
            return res.status(403).json({ success: false, message: "Droits insuffisants pour ajouter un composant." });
        }

        const nouveauComposant = {
            bretbau_id,
            nom,
            ajoute_par,
            defaut_count: 0,
            modification_count: 0,
            replacement_count: 0,
            temps_darret: 0,
            defauts_mois_actuel: 0,
            dernier_mois_enregistre: null
        };

        if (id && id.trim() !== "") {
            nouveauComposant.id = id;
        }

        const { error } = await supabase
            .from('composant')
            .insert([nouveauComposant]);

        if (error) throw error;
        res.json({ success: true, message: "Composant ajouté avec succès." });
    } catch (error) {
        console.error("Erreur ajout composant :", error);
        res.status(400).json({ success: false, message: error.message });
    }
});

// ROUTE : Supprimer un composant — réservé à role_composant = admin (matricule transmis en query)
app.delete('/api/composants/:id', async (req, res) => {
    const { id } = req.params;
    const { matricule } = req.query;
    try {
        const autorise = await estAdmin(matricule, 'role_composant');
        if (!autorise) {
            return res.status(403).json({ success: false, message: "Droits insuffisants pour supprimer un composant." });
        }

        const { error } = await supabase.from('composant').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: "Composant supprimé." });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Serveur Backend démarré sur le port ${PORT}`);
});