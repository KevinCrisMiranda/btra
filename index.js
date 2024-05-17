const express = require('express');
const app = express();
const morgan = require('morgan');
const bodyParser = require('body-parser');
const verifyToken = require('./functions/verifyToken')
const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const SteamTotp = require('steam-totp');
const TradeOfferManager = require('steam-tradeoffer-manager'); // use  in production
const encontrarCoincidencias  = require('./functions/coincidencias')
const encontrarCoincidenciasW = require('./functions/coincidenciasW');
const pool = require('./config/database');
const FS = require('fs');
require("dotenv").config()

let client = new SteamUser();
let manager = new TradeOfferManager({
	"steam": client, // Polling every 30 seconds is fine since we get notifications from Steam
	"domain": "https://localhost:3001", // Our domain is example.com
	"language": "en",
	"cancelTime" : 60000,
    "pendingCancelTime" : 60000,
	"useAccessToken": true // We want English item descriptions
});
const steam = new SteamCommunity();
// // Steam logon options
const logOnOptions = {
	"accountName": process.env.AN,
	"password": process.env.PSW,
	"twoFactorCode": SteamTotp.getAuthCode(process.env.SHBOOT)
};
const identitySecret = process.env.ISBOOT;
// console.log(logOnOptions)
steam.login(logOnOptions, function(err, sessionID, cookies, steamguard) {

	if (err) {
		console.log(err)
		console.log("There was an error logging in! Error details: " + err.message);
		process.exit(1); //terminates program
	} else {
		console.log("Successfully logged in as " + logOnOptions.accountName);
		steam.chatLogon();
		manager.setCookies(cookies, function(err) {
			if (err) {
				console.log(err);
				process.exit(1);
			}
		});
	}
	steam.startConfirmationChecker(10000, identitySecret); //Auto-confirmation enabled!
	
});

// OFERTYAS ENVIADAS
manager.on('sentOfferChanged',async function  (offer, oldState) {
	try {
		// TRADE CANCELADO 
		if (TradeOfferManager.ETradeOfferState[offer.state] === 'Declined' || TradeOfferManager.ETradeOfferState[offer.state] === 'Canceled') {
			const result = await pool.query('SELECT u.saldo, u.depositado, o.userId, o.tipo, o.id, o.costo, (u.saldo + o.costo) AS total FROM ofertas o INNER JOIN usuarios u ON o.userId = u.steamid WHERE o.id = '+offer.id);
			if (result[0]?.tipo === 'retiro') {
				const {total, userId} = result[0];
				pool.query("UPDATE usuarios Set saldo=? WHERE steamid=?", [total, userId], (err, result) => {})
			} 
				pool.query("UPDATE ofertas Set estado=? WHERE id=?", ['Cancelado', offer.id], (err, result) => {})
		} 
		// TRADE ACEPTADO
		if (TradeOfferManager.ETradeOfferState[offer.state] === 'Accepted') {
			pool.query("UPDATE ofertas Set estado=? WHERE id=?", ['Aceptado', offer.id], (err, result) => { })
			const result = await pool.query('SELECT u.saldo, u.depositado, o.tipo, o.userId, o.id, o.costo, (u.saldo + o.costo) AS total FROM ofertas o INNER JOIN usuarios u ON o.userId = u.steamid WHERE o.id = ' + offer.id);
			if (result[0].tipo === 'deposito') {
				const { total, userId } = result[0];
				pool.query("UPDATE usuarios Set saldo=? WHERE steamid=?", [total, userId], (err, result) => { })
			}
		}
		
		console.log(`Offer sent #${offer.id} changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);
	} catch (error) {
		console.log(error)
	}
});

// NUEVAS OFERTAS
manager.on('newOffer', function (offer) {
	try {
		console.log(`Nueva oferta #${offer.id} - items pedidos ${offer.itemsToGive}`);
		const randomWait = Math.floor(Math.random() * (30000 - 5000 + 1) + 5000);
		setTimeout(() => {
			if (offer.itemsToGive.length <= 0) {
				offer.accept(function (err, status) {
					if (!err) {
						console.log(`oferta aceptada ${status}`);
					}
				});
			} else {
				offer.decline(function (err) {
					if (!err) {
					  console.log('Oferta rechazada');
					}
				  });
			}
		}, randomWait);
	} catch (error) {
		console.log(error)
	}
});

// OFERTAS RECIVIDAS
manager.on('receivedOfferChanged', function(offer, oldState) {
	console.log(`Offer recived #${offer.id} changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);
})

manager.on('pollData', function(pollData) {
	FS.writeFileSync('polldata.json', JSON.stringify(pollData));
});

app.set('port', process.env.PORT || 4002);
app.use(bodyParser.urlencoded({extended: false}));
app.use(express.json());
app.use(morgan('dev'));

app.get('/', async (req, res) => {
	return res.json({ saldo: "Funciona Kevin", nombre: "", promo: "off" })
});

app.post('/deposit', verifyToken, async (req,res) => {
	const { id, url, selectedItems} = req.body;
	var offer = '';
	
	try {
		manager.getUserInventoryContents(id, 570, 2, true, async (err, inventory) => {
			// ERROR AL CARGAR INVENTARIO
			if (err) {
				console.log(err);
				return res.json({ message: 'Error al cargar inventario', estado: 'error' })
			}
			// INVENTARIO EN CERO
			if (inventory.length == 0) {
				// Inventory empty
				res.json({ message: 'Error al cargar inventario sin items', estado: 'error' })
			}
			// CREANDO OFERTA
			offer = manager.createOffer(url);
			// AÑADIENDO OFERTA
			inventory.forEach(function (item) {
				for (var i = 0; i < selectedItems.length; i++) {
					if (item.assetid === selectedItems[i].assetid) {
								offer.addTheirItem(item);
					}
				}
			})
			// MENSAJE OFERTA
			offer.setMessage("codigo:frd31");
			// OFERTA ENVIADA
			offer.send(async (err, status) => {
				if (err) {
					console.log(err)
					return res.json({ message: "Problema con el servidor de steam", estado: "error" })
				} else {
					if (status == 'pending') {
						steam.acceptConfirmationForObject(identitySecret, offer.id, function (err) {
							if (err) {
								return res.json({ message: "Problema con aceptar Trade", estado: "error" })
							} else {
								console.log("Offer confirmed");
							}
						});
					} else {
						const result = await pool.query('SELECT * FROM lista');
						const [itemsCoin, getItems] = await encontrarCoincidencias(inventory, selectedItems, result);
						pool.query('INSERT INTO ofertas (`id`, `tipo`, `userId`, `costo`, `estado`, `plataforma`) VALUES ("' +offer.id + '","deposito","' + id + '","'+itemsCoin+'","Enviado","steam")', (err) => {
							if (err) {
							  console.log(err)
							  return res.json({ message: "Problema al agregar", estado: "error" })
							}
							return res.json({ message:`Offer #${offer.id} sent successfully`, estado: "success"});
						  });
						
					} 
				}
			})
		});
	} catch (error) {
		return res.json({ message:`Error al enviar oferta`, estado: "error"});
	}
})

app.post('/retiro', verifyToken, async (req, res) => {
	const { id, url, otherItems } = req.body;
	var offer = '';

	try {
		const result = await pool.query('SELECT * FROM lista');
		const saldoUser = await pool.query('SELECT saldo, url FROM usuarios WHERE steamid=' + id)
		manager.getUserInventoryContents(process.env.BOTIDS, 570, 2, true, async (err, inventory) => {
			// ERROR AL CARGAR INVENTARIO
			console.log('FUNCA ERROR 1')
			console.log(err)
			const [itemsCoin, getItems] = await encontrarCoincidenciasW(inventory, otherItems, result);
			const saldoSuficiente = saldoUser[0].saldo >= itemsCoin;
			if (!saldoSuficiente) {
				return res.json({ message: 'Saldo Insuficiente', estado: 'error' });
			}

			if (err) {
				console.log(err);
				return res.json({ message: 'Error al cargar inventario', estado: 'error' })
			}
			// INVENTARIO EN CERO
			if (inventory.length == 0) {
				// Inventory empty
				return res.json({ message: 'Error al cargar inventario sin items', estado: 'error' })
			}
			// CREANDO OFERTA
			offer = manager.createOffer(url);
			// AÑADIENDO OFERTA
			inventory.forEach(function (item) {
				for (var i = 0; i < getItems.length; i++) {
					if (item.assetid === getItems[i].assetid) {
						offer.addMyItem(item);
					}
				}
			})
			// MENSAJE OFERTA
			offer.setMessage("codigo:frd31");
			//ACTUALIZACION SALDO
			let newSaldoRetiro = saldoUser[0].saldo - itemsCoin;
			newSaldoRetiro = newSaldoRetiro.toFixed(2)
			pool.query("UPDATE usuarios Set saldo=? WHERE steamid=?", [newSaldoRetiro, id], (err, result) => {
				if (err) {
					res.json({ message: 'Error al actualizar saldo', estado: 'error' })
				}
			})
			// OFERTA ENVIADA
			offer.send(async (err, status) => {
				if (err) {
					console.log(err)
					pool.query("UPDATE usuarios Set saldo=? WHERE steamid=?", [saldoUser[0].saldo, id], (err, result) => {})
					return res.json({ message: "Problema con el servidor de steam", estado: "error" })
				} else {
					if (status == 'pending') {
						steam.acceptConfirmationForObject(identitySecret, offer.id, function (err) {
								pool.query('INSERT INTO ofertas (`id`, `tipo`, `userId`, `costo`, `estado`, `plataforma`) VALUES ("' + offer.id + '","retiro","' + id + '","' + itemsCoin + '","Enviado", "steam")', (err) => {
									if (err) {
										console.log(err)
										return res.json({ message: "Problema al agregar", estado: "error" })
									}
									return res.json({ message: `Offer #${offer.id} sent successfully`, estado: "success" });
								});
						});
					} 
				}
			})
		});
	} catch (error) {
		console.log(error)
		return res.json({ message: `Error al enviar oferta`, estado: "error" });
	}
})

app.post('/retiro-ramses', verifyToken, async (req, res) => {
	const { id, url, ramsesItems } = req.body;
	var offer = '';
	try {
		const result = await pool.query('SELECT * FROM lista');
		const idOffertLast = await pool.query('SELECT idOfer FROM ofertas ORDER BY id DESC LIMIT 1');
		const saldoUser = await pool.query('SELECT saldo, url FROM usuarios WHERE steamid=' + id)
		manager.getUserInventoryContents(process.env.BOTIDS2, 570, 2, true, async (err, inventory) => {
			// ERROR AL CARGAR INVENTARIO
			const [itemsCoin, getItems] = await encontrarCoincidenciasW(inventory, ramsesItems, result);
			const saldoSuficiente = saldoUser[0].saldo >= itemsCoin;
			if (!saldoSuficiente) {
				return res.json({ message: 'Saldo Insuficiente', estado: 'error' });
			}


			if (err) {
				console.log(err);
				return res.json({ message: 'Error al cargar inventario', estado: 'error' })
			}
			// INVENTARIO EN CERO
			if (inventory.length == 0) {
				// Inventory empty
				return res.json({ message: 'Error al cargar inventario items no encontrados', estado: 'error' })
			}
		
			//ACTUALIZACION SALDO
			let newSaldoRetiro = saldoUser[0].saldo - itemsCoin;
			newSaldoRetiro = newSaldoRetiro.toFixed(2)
			pool.query("UPDATE usuarios Set saldo=? WHERE steamid=?", [newSaldoRetiro, id], (err, result) => {
				if (err) {
					res.json({ message: 'Error al actualizar saldo', estado: 'error' })
				}
			})
			// Obtén el último ID de los resultados
			let lastId = idOffertLast[0].idOfer;

			// Genera tres letras aleatorias en mayúsculas
			const randomLetters = Math.random().toString(36).substring(2, 5).toUpperCase();

			const maxLength = 16; // Por ejemplo, si deseas un máximo de 16 caracteres

			// Combina el último ID con las letras aleatorias y luego recorta la cadena si es necesario
			let newId = lastId + randomLetters;

			//INSERTANDO OFERTA 
			pool.query('INSERT INTO ofertas (`id`, `tipo`, `userId`, `costo`, `estado`, `plataforma`) VALUES ("' + newId + '","retiro","' + id + '","' + itemsCoin + '","Pendiente", "steam")', (err, result) => {
				if (err) {
					console.log(err)
					return res.json({ message: "Problema al agregar", estado: "error" })
				}
				const newIdurl = result.insertId;
				return res.json({ message: `Offer # sent successfully`, estado: "success", getItems, id:newIdurl  });
			});

		});
	} catch (error) {
		console.log(error)
		return res.json({ message: `Error al enviar oferta`, estado: "error" });
	}
})

app.listen(process.env.PORTSECBOT, () => {
    console.log(`Servidor activo `+ process.env.PORTSECBOT)
})


