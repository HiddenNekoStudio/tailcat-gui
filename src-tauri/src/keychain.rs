use keyring::Entry;

const SERVICE: &str = "dev.tailcat.gui";

pub fn store_address(id: &str, address: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, id).map_err(|e| e.to_string())?;
    entry.set_password(address).map_err(|e| e.to_string())
}

pub fn load_address(id: &str) -> Option<String> {
    Entry::new(SERVICE, id).ok()?.get_password().ok()
}

pub fn delete_address(id: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, id).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}
