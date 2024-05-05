function encontrarCoincidencias(objeto1, objeto2, itemsSql) {
    let coincidencias = [];
    let getItems = [];
    let totalItems = 0;

    for (let i = 0; i < objeto1.length; i++) {
      for (let j = 0; j < objeto2.length; j++) {
        if (objeto1[i].assetid === objeto2[j].assetid) {
          coincidencias.push(objeto1[i]);
          getItems.push(objeto1[i])
        }
      }
    }
    
     for (let i = 0; i < coincidencias.length; i++) {
      for (let j = 0; j < itemsSql.length; j++) {
        if (coincidencias[i].name === itemsSql[j].item) {
            totalItems = totalItems + itemsSql[j].deposito;
        }
      }
    }

    return [totalItems, getItems];
}
module.exports = encontrarCoincidencias;